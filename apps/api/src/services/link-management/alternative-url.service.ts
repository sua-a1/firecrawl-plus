import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../../supabase_types";
import { logger } from "../../lib/logger";
import { performCosineSimilarity } from "../../lib/map-cosine";
import { searchSimilarPages } from "../../lib/extract/index/pinecone";
import { robustFetch } from "../../scraper/scrapeURL/lib/fetch";
import { OpenAIEmbeddingsService } from "./openai-embeddings.service";
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reranker } from './reranker';

// Types
interface WaybackSnapshot {
  url: string;
  timestamp: string;
  status: string;
}

interface AlternativeUrlResult {
  originalUrl: string;
  alternativeUrls: {
    url: string;
    source: 'wayback' | 'similar' | 'ai';
    score: number;
    metadata?: Record<string, any>;
  }[];
}

interface AlternativeUrlOptions {
  maxResults?: number;
  minSimilarityScore?: number;
  useWaybackMachine?: boolean;
  useSimilarityMatching?: boolean;
  useAIMatching?: boolean;
  projectId: number;
  openAIConfig?: {
    apiKey: string;
    model?: string;
    dimensions?: number;
  };
  contextWeights?: {
    url?: number;
    title?: number;
    description?: number;
  };
}

interface ContextData {
  url: string;
  title?: string;
  description?: string;
}

@Injectable()
export class AlternativeUrlService {
  private readonly logger = logger.child({
    module: "link-management",
    service: "AlternativeUrlService",
  });
  private readonly WAYBACK_API_BASE = "https://archive.org/wayback/available";
  private readonly WAYBACK_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private readonly embeddingsService: OpenAIEmbeddingsService;
  private reranker: Reranker;

  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly options: AlternativeUrlOptions
  ) {
    if (options.useAIMatching && !options.openAIConfig?.apiKey) {
      throw new Error("OpenAI API key is required when useAIMatching is enabled");
    }

    if (options.openAIConfig) {
      this.embeddingsService = new OpenAIEmbeddingsService(supabase, options.openAIConfig);
    }

    const cohereApiKey = process.env.COHERE_API_KEY;
    if (!cohereApiKey) {
      throw new Error('COHERE_API_KEY is not defined');
    }
    this.reranker = new Reranker(cohereApiKey);
  }

  /**
   * Find alternative URLs using multiple strategies
   */
  async findAlternativeUrls(
    url: string,
    context?: { title?: string; description?: string }
  ): Promise<AlternativeUrlResult> {
    const result: AlternativeUrlResult = {
      originalUrl: url,
      alternativeUrls: [],
    };

    try {
      // Run all strategies in parallel
      const [waybackUrls, similarUrls, aiUrls] = await Promise.all([
        this.options.useWaybackMachine ? this.findWaybackUrls(url) : Promise.resolve([]),
        this.options.useSimilarityMatching ? this.findSimilarUrls(url, context) : Promise.resolve([]),
        this.options.useAIMatching ? this.findAIBasedUrls(url, context) : Promise.resolve([]),
      ]);

      // Combine and deduplicate results
      result.alternativeUrls = this.combineAndDeduplicate([
        ...waybackUrls.map(u => ({ ...u, source: 'wayback' as const })),
        ...similarUrls.map(u => ({ ...u, source: 'similar' as const })),
        ...aiUrls.map(u => ({ ...u, source: 'ai' as const })),
      ]);

      this.logger.debug("Found alternative URLs", {
        originalUrl: url,
        alternativeCount: result.alternativeUrls.length,
      });

    } catch (error) {
      this.logger.error("Error finding alternative URLs", {
        error,
        url,
      });
    }

    return result;
  }

  /**
   * Find archived versions using Wayback Machine API
   */
  private async findWaybackUrls(url: string): Promise<Array<{ url: string; score: number; metadata?: any }>> {
    try {
      // Check cache first
      const cachedResult = await this.getWaybackCache(url);
      if (cachedResult) {
        return cachedResult;
      }

      // Query Wayback Machine API
      const response = await robustFetch({
        url: `${this.WAYBACK_API_BASE}?url=${encodeURIComponent(url)}`,
        method: "GET",
        logger: this.logger.child({ method: "findWaybackUrls" }),
        mock: null,
        tryCount: 3,
        tryCooldown: 1000,
        ignoreFailure: false,
        dontParseResponse: false
      });

      if (!response?.archived_snapshots?.closest) {
        return [];
      }

      const snapshot: WaybackSnapshot = response.archived_snapshots.closest;
      const result = [{
        url: snapshot.url,
        score: 1.0, // Wayback matches are exact
        metadata: {
          timestamp: snapshot.timestamp,
          status: snapshot.status
        }
      }];

      // Cache the result
      await this.setWaybackCache(url, result);

      return result;

    } catch (error) {
      this.logger.error("Failed to query Wayback Machine", {
        error,
        url,
      });
      return [];
    }
  }

  /**
   * Find similar URLs using existing similarity functions
   */
  async findSimilarUrls(
    url: string, 
    context?: { title?: string; description?: string }
  ): Promise<Array<{ url: string; score: number }>> {
    try {
      this.logger.debug('Finding similar URLs:', {
        originalUrl: url,
        context
      });
      
      // Parse URL for better search terms
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);
      const searchTerms = urlObj.pathname.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
      
      // Construct search query with weighted components
      const searchComponents = [
        context?.title || '',
        context?.description || '',
        searchTerms,
        ...pathSegments
      ].filter(Boolean);

      // Log search components for debugging
      this.logger.debug('Search components:', {
        title: context?.title,
        description: context?.description,
        pathSegments,
        searchTerms
      });

      // Use all components for search
      const searchQuery = searchComponents.join(' ');
      
      this.logger.debug('Search parameters:', {
        searchQuery,
        domain: urlObj.hostname
      });

      this.logger.debug('Calling searchSimilarPages...');
      let similarPages = await searchSimilarPages(searchQuery, url);

      // Log raw results for debugging
      this.logger.debug('Raw search results:', {
        count: similarPages?.length || 0,
        results: similarPages?.map(p => ({
          url: p.url,
          title: p.title,
          score: p.score
        }))
      });
      
      if (!similarPages?.length) {
        this.logger.debug('No similar pages found in search');
        // Try a second search without domain restriction if no results
        this.logger.debug('Attempting broader search without domain restriction...');
        const broaderResults = await searchSimilarPages(searchQuery);
        if (!broaderResults?.length) {
          this.logger.debug('No results found in broader search');
          return [];
        }
        similarPages = broaderResults;
      }

      // Filter and validate results
      const validPages = similarPages
        .filter(p => {
          if (!p.url || p.url === url) return false;
          try {
            new URL(p.url); // Validate URL format
            return true;
          } catch {
            return false;
          }
        })
        .map(page => ({
          url: page.url,
          title: page.title || '',
          description: page.description || '',
          score: page.score || 0
        }));

      this.logger.debug('Filtered results:', {
        validCount: validPages.length,
        validUrls: validPages.map(p => p.url)
      });

      if (!validPages.length) {
        this.logger.debug('No valid pages after filtering');
        return [];
      }

      // Sort by score and return top results
      const finalResults = validPages
        .sort((a, b) => b.score - a.score)
        .slice(0, this.options.maxResults || 5)
        .map(page => ({
          url: page.url,
          score: page.score
        }));

      this.logger.debug('Final results:', {
        count: finalResults.length,
        results: finalResults
      });

      return finalResults;

    } catch (error) {
      this.logger.error('Error finding similar URLs:', {
        error,
        url
      });
      return [];
    }
  }

  /**
   * Find alternative URLs using AI-based matching with OpenAI embeddings
   */
  private async findAIBasedUrls(
    url: string,
    context?: { title?: string; description?: string }
  ): Promise<Array<{ url: string; score: number }>> {
    try {
      if (!this.embeddingsService) {
        this.logger.warn("OpenAI embeddings service not initialized");
        return [];
      }

      // Parse original URL for better matching
      const originalUrlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      const originalDomain = originalUrlObj.hostname.replace('www.', '');
      const originalPath = originalUrlObj.pathname;
      const originalPathSegments = originalPath.split('/').filter(Boolean);

      this.logger.debug('Processing URL for AI matching', {
        originalUrl: url,
        domain: originalDomain,
        path: originalPath,
        segments: originalPathSegments
      });

      // Get all URLs from the project with their context
      const { data: projectUrls, error: queryError } = await this.supabase
        .from("links")
        .select(`
          extracted_link,
          anchor_text,
          is_internal,
          status_code
        `)
        .eq("project_id", this.options.projectId)
        .not('status_code', 'in', '(404,500)'); // Only consider working URLs

      if (queryError) {
        this.logger.error('Failed to fetch project URLs', { error: queryError });
        return [];
      }

      // First, try to find same-domain matches with similar paths
      const sameDomainMatches = projectUrls
        ?.filter(urlData => {
          try {
            const candidateUrl = new URL(urlData.extracted_link);
            return candidateUrl.hostname.replace('www.', '') === originalDomain;
          } catch {
            return false;
          }
        })
        .map(urlData => {
          const candidateUrl = new URL(urlData.extracted_link);
          const candidatePath = candidateUrl.pathname;
          const candidateSegments = candidatePath.split('/').filter(Boolean);
          
          // Calculate path similarity score
          let pathScore = 0;
          
          // Exact first segment match gets high score
          if (candidateSegments[0] === originalPathSegments[0]) {
            pathScore += 0.5;
          }
          
          // Handle version numbers (e.g., v1, v2)
          const isVersionedPath = originalPathSegments.some(s => /v\d+/.test(s));
          if (isVersionedPath && candidateSegments[0] === originalPathSegments[0]) {
            pathScore += 0.3;
          }
          
          // Handle common patterns
          if (originalPathSegments.includes('legacy') && candidateSegments.length === 1) {
            pathScore += 0.2; // Prefer main section for legacy URLs
          }
          
          // Calculate segment similarity
          const segmentMatches = originalPathSegments.filter(seg => 
            candidateSegments.some(candSeg => this.areSegmentsSimilar(seg, candSeg))
          ).length;
          pathScore += (segmentMatches / Math.max(originalPathSegments.length, 1)) * 0.4;

          return {
            url: urlData.extracted_link,
            score: 1 + pathScore // Base score of 1 for same domain, plus path similarity
          };
        })
        .filter(result => result.score > 1.3) // Require significant path similarity
        .sort((a, b) => b.score - a.score);

      if (sameDomainMatches && sameDomainMatches.length > 0) {
        this.logger.debug('Found same-domain matches', {
          matches: sameDomainMatches.map(m => ({
            url: m.url,
            score: m.score
          }))
        });
        return sameDomainMatches;
      }

      // If no good same-domain matches, proceed with embedding-based matching
      // Process query context
      const queryContext: ContextData = {
        url,
        title: context?.title,
        description: context?.description
      };

      this.logger.debug('Query context', {
        context: queryContext
      });

      // Generate embeddings for query context
      const queryEmbeddings = await this.generateContextEmbeddings(queryContext);

      this.logger.debug('Generated query embeddings', {
        components: Array.from(queryEmbeddings.keys())
      });

      // Process and compare each URL
      const results = await Promise.all(
        projectUrls.map(async (urlData) => {
          try {
            const urlContext: ContextData = {
              url: urlData.extracted_link,
              title: urlData.anchor_text || undefined
            };

            // Get or generate embeddings for URL context
            const urlEmbeddings = await this.getOrGenerateEmbeddings(urlContext);

            // Calculate weighted similarity score
            const score = this.calculateWeightedSimilarity(queryEmbeddings, urlEmbeddings);

            // Parse candidate URL
            const candidateUrlObj = new URL(urlData.extracted_link);
            const candidateDomain = candidateUrlObj.hostname.replace('www.', '');
            const candidatePath = candidateUrlObj.pathname;

            // Boost score for same domain matches
            const domainBoost = originalDomain === candidateDomain ? 0.3 : -0.2; // Increased boost for same domain, penalty for different domain
            
            // Boost score for similar path structure
            const pathBoost = this.calculatePathSimilarity(originalPath, candidatePath);

            // Apply boosts
            const finalScore = score + domainBoost + (pathBoost * 2); // Double the path similarity importance

            this.logger.debug('URL similarity calculation', {
              candidateUrl: urlData.extracted_link,
              baseScore: score,
              domainBoost,
              pathBoost,
              finalScore,
              isSameDomain: originalDomain === candidateDomain
            });

            // Filter out generic fallbacks more strictly
            const isGenericFallback = (
              candidatePath === '/' || // Homepage
              candidateUrlObj.hostname.includes('github.com') || // Generic GitHub
              candidateUrlObj.hostname.includes('google.com') || // Generic Google
              candidateUrlObj.pathname.includes('search') // Search pages
            );
            
            if (isGenericFallback && (
              finalScore < 0.9 || // Higher threshold for generic pages
              originalDomain !== candidateDomain // Must be same domain for generic pages
            )) {
              this.logger.debug('Filtered out generic fallback', {
                url: urlData.extracted_link,
                score: finalScore,
                reason: 'generic_url'
              });
              return null;
            }

            return {
              url: urlData.extracted_link,
              score: finalScore
            };
          } catch (error) {
            this.logger.error("Failed to process URL embedding", {
              error,
              url: urlData.extracted_link
            });
            return null;
          }
        })
      );

      // Filter out failed results and sort by score
      const validResults = results
        .filter((result): result is { url: string; score: number } => 
          result !== null && 
          result.score >= (this.options.minSimilarityScore || 0.75) // Reduced from 0.85
        )
        .sort((a, b) => b.score - a.score);

      this.logger.debug('Final AI matching results', {
        totalResults: results.length,
        validResults: validResults.length,
        topScores: validResults.slice(0, 3).map(r => ({
          url: r.url,
          score: r.score
        }))
      });

      return validResults;

    } catch (error) {
      this.logger.error("Failed to find AI-based alternative URLs", {
        error,
        url,
      });
      return [];
    }
  }

  /**
   * Calculate similarity between two URL paths
   */
  private calculatePathSimilarity(path1: string, path2: string): number {
    // Remove leading/trailing slashes and split into segments
    const segments1 = path1.split('/').filter(Boolean);
    const segments2 = path2.split('/').filter(Boolean);

    // If both are empty (root paths), return 0 boost
    if (segments1.length === 0 && segments2.length === 0) {
      return 0;
    }

    // If one is empty and other isn't, lower similarity
    if (segments1.length === 0 || segments2.length === 0) {
      return -0.1;
    }

    // Compare path segments
    const maxSegments = Math.max(segments1.length, segments2.length);
    let matchingSegments = 0;

    for (let i = 0; i < Math.min(segments1.length, segments2.length); i++) {
      // Use Levenshtein distance or similar algorithm for fuzzy matching
      if (this.areSegmentsSimilar(segments1[i], segments2[i])) {
        matchingSegments++;
      }
    }

    // Calculate similarity score (0 to 0.2)
    return (matchingSegments / maxSegments) * 0.2;
  }

  /**
   * Check if two URL path segments are similar
   */
  private areSegmentsSimilar(seg1: string, seg2: string): boolean {
    // Convert to lowercase and remove common URL parts
    seg1 = seg1.toLowerCase().replace(/[-_]/g, '');
    seg2 = seg2.toLowerCase().replace(/[-_]/g, '');

    // If segments are identical, return true
    if (seg1 === seg2) return true;

    // If one segment is contained within the other, consider them similar
    if (seg1.includes(seg2) || seg2.includes(seg1)) return true;

    // Calculate Levenshtein distance
    const maxLength = Math.max(seg1.length, seg2.length);
    const distance = this.levenshteinDistance(seg1, seg2);
    
    // Allow up to 30% difference
    return distance <= maxLength * 0.3;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j - 1] + 1, // substitution
            dp[i - 1][j] + 1,     // deletion
            dp[i][j - 1] + 1      // insertion
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Generate embeddings for each context component
   */
  private async generateContextEmbeddings(context: ContextData): Promise<Map<string, number[]>> {
    const embeddings = new Map<string, number[]>();
    
    try {
      // Generate embeddings for each context component in parallel
      const [urlEmbed, titleEmbed, descEmbed] = await Promise.all([
        this.embeddingsService.embedText(this.preprocessUrl(context.url)),
        context.title ? this.embeddingsService.embedText(context.title) : Promise.resolve(null),
        context.description ? this.embeddingsService.embedText(context.description) : Promise.resolve(null)
      ]);

      embeddings.set('url', urlEmbed);
      if (titleEmbed) embeddings.set('title', titleEmbed);
      if (descEmbed) embeddings.set('description', descEmbed);

      return embeddings;
    } catch (error) {
      this.logger.error("Failed to generate context embeddings", {
        error,
        context: { ...context, url: context.url.substring(0, 100) }
      });
      throw error;
    }
  }

  /**
   * Get cached embeddings or generate new ones
   */
  private async getOrGenerateEmbeddings(context: ContextData): Promise<Map<string, number[]>> {
    try {
      // Check cache for URL embedding
      const { data: cached } = await this.supabase
        .from("url_embeddings")
        .select("embedding, model")
        .eq("url", context.url)
        .single();

      const embeddings = new Map<string, number[]>();

      if (cached && cached.model === this.options.openAIConfig?.model) {
        embeddings.set('url', cached.embedding);
      } else {
        // Generate new embedding
        const urlEmbed = await this.embeddingsService.embedText(this.preprocessUrl(context.url));
        embeddings.set('url', urlEmbed);

        // Cache the new embedding
        await this.supabase.from("url_embeddings").upsert({
          url: context.url,
          embedding: urlEmbed,
          model: this.options.openAIConfig?.model || "text-embedding-3-small"
        });
      }

      // Generate embeddings for additional context
      if (context.title) {
        embeddings.set('title', await this.embeddingsService.embedText(context.title));
      }

      return embeddings;
    } catch (error) {
      this.logger.error("Failed to get or generate embeddings", {
        error,
        context: { ...context, url: context.url.substring(0, 100) }
      });
      throw error;
    }
  }

  /**
   * Calculate weighted similarity score between two sets of embeddings
   */
  private calculateWeightedSimilarity(
    queryEmbeddings: Map<string, number[]>,
    urlEmbeddings: Map<string, number[]>
  ): number {
    // Define default weights
    const defaultWeights = {
      url: 0.5,      // 50% weight for URL similarity
      title: 0.3,    // 30% weight for title similarity
      description: 0.2 // 20% weight for description similarity
    };

    // Merge with user-provided weights or use defaults
    const weights = {
      ...defaultWeights,
      ...this.options.contextWeights
    };

    let totalScore = 0;
    let totalWeight = 0;

    // Calculate URL similarity (always present)
    const urlScore = this.embeddingsService.calculateCosineSimilarity(
      queryEmbeddings.get('url')!,
      urlEmbeddings.get('url')!
    );
    totalScore += urlScore * weights.url;
    totalWeight += weights.url;

    // Calculate title similarity if available
    if (queryEmbeddings.has('title') && urlEmbeddings.has('title')) {
      const titleScore = this.embeddingsService.calculateCosineSimilarity(
        queryEmbeddings.get('title')!,
        urlEmbeddings.get('title')!
      );
      totalScore += titleScore * (weights.title || 0);
      totalWeight += weights.title || 0;
    }

    // Calculate description similarity if available
    if (queryEmbeddings.has('description')) {
      const descScore = this.embeddingsService.calculateCosineSimilarity(
        queryEmbeddings.get('description')!,
        urlEmbeddings.get('url')! // Compare description with URL as fallback
      );
      totalScore += descScore * (weights.description || 0);
      totalWeight += weights.description || 0;
    }

    // Normalize the final score
    return totalScore / totalWeight;
  }

  /**
   * Preprocess URL for embedding
   */
  private preprocessUrl(url: string): string {
    return url
      .replace(/^https?:\/\//, '') // Remove protocol
      .replace(/\/$/, '')          // Remove trailing slash
      .replace(/[_-]/g, ' ')      // Replace underscores and hyphens with spaces
      .toLowerCase();
  }

  /**
   * Combine and deduplicate results from different sources
   */
  private combineAndDeduplicate(
    results: Array<{
      url: string;
      score: number;
      source: 'wayback' | 'similar' | 'ai';
      metadata?: any;
    }>
  ) {
    // Remove duplicates, keeping the highest scoring version
    const uniqueResults = new Map<string, typeof results[0]>();
    
    for (const result of results) {
      const existing = uniqueResults.get(result.url);
      if (!existing || existing.score < result.score) {
        uniqueResults.set(result.url, result);
      }
    }

    // Sort by score descending
    return Array.from(uniqueResults.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, this.options.maxResults || 10);
  }

  /**
   * Cache management for Wayback Machine results
   */
  private async getWaybackCache(url: string) {
    const { data } = await this.supabase
      .from("wayback_cache")
      .select("result, cached_at")
      .eq("url", url)
      .single();

    if (!data) return null;

    // Check if cache is still valid
    const age = Date.now() - new Date(data.cached_at).getTime();
    if (age > this.WAYBACK_CACHE_DURATION) {
      return null;
    }

    return data.result;
  }

  private async setWaybackCache(url: string, result: any) {
    await this.supabase
      .from("wayback_cache")
      .upsert({
        url,
        result,
        cached_at: new Date().toISOString(),
      });
  }
} 