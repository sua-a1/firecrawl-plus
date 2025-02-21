import { Database } from "../../supabase_types";
import { SupabaseClient, PostgrestResponse } from "@supabase/supabase-js";
import { extractLinks } from "../../scraper/scrapeURL/lib/extractLinks";
import { logger as _logger } from "../../lib/logger";
import { normalizeUrl } from "../../lib/canonical-url";
import { removeDuplicateUrls } from "../../lib/validateUrl";
import { isUrlBlocked } from "../../scraper/WebScraper/utils/blocklist";
import { robustFetch } from "../../scraper/scrapeURL/lib/fetch";
import { batchProcess } from "../../lib/batch-process";
import { AlternativeUrlService } from "./alternative-url.service";
import { validateLinkFetch } from './link-validation-fetch';
import { indexPage } from "../../lib/extract/index/pinecone";

// Types
type Link = Database["public"]["Tables"]["links"]["Row"];
type LinkInsert = Database["public"]["Tables"]["links"]["Insert"];
type LinkRedirect = Database["public"]["Tables"]["link_redirects"]["Row"];
type LinkRedirectInsert = Database["public"]["Tables"]["link_redirects"]["Insert"];
type SourceLink = Database["public"]["Tables"]["source_links"]["Row"];
type SourceLinkInsert = Database["public"]["Tables"]["source_links"]["Insert"];

interface LinkValidationResult {
  url: string;
  statusCode: number;
  redirectUrl?: string;
  redirectType?: string;
  error?: string;
}

interface RateLimitOptions {
  delayBetweenBatches?: number; // Delay in milliseconds between batches
  requestsPerBatch?: number; // Number of concurrent requests per batch
  maxRequestsPerMinute?: number; // Maximum requests allowed per minute
}

interface LinkManagementOptions {
  projectId: number;
  allowExternalLinks?: boolean;
  includeSubdomains?: boolean;
  maxRetries?: number;
  batchSize?: number;
  requestTimeout?: number;
  rateLimit?: RateLimitOptions; // Add rate limit options
  alternativeUrlOptions?: {
    maxResults?: number;
    minSimilarityScore?: number;
    useWaybackMachine?: boolean;
    useSimilarityMatching?: boolean;
    useAIMatching?: boolean;
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
  };
}

export class LinkManagementService {
  private readonly logger = _logger.child({
    module: "link-management",
    service: "LinkManagementService",
  });

  private alternativeUrlService: AlternativeUrlService | null = null;

  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly options: LinkManagementOptions
  ) {
    // Initialize AlternativeUrlService if options are provided
    if (options.alternativeUrlOptions) {
      this.alternativeUrlService = new AlternativeUrlService(supabase, {
        projectId: options.projectId,
        ...options.alternativeUrlOptions
      });
    }
  }

  /**
   * Extract and store links from HTML content
   */
  async extractAndStoreLinks(
    pageUrl: string,
    html: string,
    sourceId?: number,
    dataId?: string
  ): Promise<Link[]> {
    try {
      this.logger.info("Starting link extraction process", {
        pageUrl,
        sourceId,
        dataId
      });

      // Extract links from HTML
      const extractedLinks = await extractLinks(html, pageUrl);
      this.logger.debug("Links extracted from HTML", {
        pageUrl,
        extractedCount: extractedLinks.length,
        extractedUrls: extractedLinks
      });
      
      // Filter and normalize links
      const normalizedLinks = this.filterAndNormalizeLinks(extractedLinks);
      this.logger.debug("Links filtered and normalized", {
        originalCount: extractedLinks.length,
        normalizedCount: normalizedLinks.length,
        normalizedUrls: normalizedLinks
      });

      // Store links in database
      const links = await this.storeLinks(pageUrl, normalizedLinks);
      this.logger.info("Links stored in database", {
        pageUrl,
        storedCount: links.length,
        sourceId,
        dataId
      });

      // If source info provided, create source_links entries
      if (sourceId && links.length > 0) {
        await this.createSourceLinks(links, sourceId, dataId);
      }

      return links;
    } catch (error) {
      this.logger.error("Failed to extract and store links", {
        error,
        pageUrl,
      });
      throw error;
    }
  }

  /**
   * Filter and normalize extracted links
   */
  private filterAndNormalizeLinks(links: string[]): string[] {
    // Remove duplicates
    let uniqueLinks = removeDuplicateUrls(links);

    // Filter based on options
    uniqueLinks = uniqueLinks.filter(url => {
      // Skip blocked URLs
      if (isUrlBlocked(url)) return false;

      // Handle external links based on options
      if (!this.options.allowExternalLinks) {
        // TODO: Implement domain matching logic
        return true; // Temporary
      }

      return true;
    });

    // Normalize URLs
    return uniqueLinks.map(url => normalizeUrl(url));
  }

  /**
   * Store links in the database
   */
  private async storeLinks(pageUrl: string, links: string[]): Promise<Link[]> {
    this.logger.info("Starting to store links", {
      pageUrl,
      linkCount: links.length,
      links
    });

    const storedLinks: Link[] = [];
    const pageUrlObj = new URL(pageUrl);
    const pageUrlDomain = pageUrlObj.hostname;

    for (const url of links) {
      try {
        // Skip special schemes like mailto:, tel:, javascript:
        if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:')) {
          this.logger.debug("Skipping special scheme URL", { url });
          continue;
        }

        // Normalize URL first
        let normalizedUrl: string;
        try {
          // Try to parse as absolute URL first
          new URL(url);
          normalizedUrl = url;
        } catch (e) {
          // If parsing fails, try to normalize
          if (url.startsWith('/')) {
            // Absolute path
            normalizedUrl = `${pageUrlObj.protocol}//${pageUrlObj.host}${url}`;
          } else if (!url.includes('://')) {
            // No protocol - add https://
            normalizedUrl = url.startsWith('www.') ? `https://${url}` : `https://www.${url}`;
          } else {
            // Try to resolve relative to base URL
            try {
              normalizedUrl = new URL(url, pageUrl).href;
            } catch (e2) {
              this.logger.error("Failed to normalize URL", { url, error: e2 });
              continue;
            }
          }
        }

        // Now parse the normalized URL
        let linkUrlObj: URL;
        try {
          linkUrlObj = new URL(normalizedUrl);
        } catch (error) {
          this.logger.error("Failed to parse normalized URL", { 
            originalUrl: url, 
            normalizedUrl,
            error 
          });
          continue;
        }

        const linkDomain = linkUrlObj.hostname;
        const isInternal = linkDomain === pageUrlDomain;
        
        this.logger.debug("Processing URL for storage", {
          originalUrl: url,
          normalizedUrl,
          isInternal,
          pageUrlDomain,
          linkDomain
        });

        const linkInsert: LinkInsert = {
          project_id: this.options.projectId,
          page_url: pageUrl,
          extracted_link: normalizedUrl,
          is_internal: isInternal,
        };

        const { data, error } = await this.supabase
          .from("links")
          .upsert([linkInsert], {
            onConflict: "project_id,page_url,extracted_link",
          })
          .select();

        if (error) {
          this.logger.error("Failed to store link", {
            error,
            pageUrl,
            url: normalizedUrl,
          });
          continue;
        }

        if (data?.[0]) {
          this.logger.debug("Successfully stored link", {
            linkId: data[0].id,
            url: data[0].extracted_link,
            isInternal: data[0].is_internal
          });
          storedLinks.push(data[0]);
        } else {
          this.logger.warn("No data returned after storing link", {
            url: normalizedUrl,
            pageUrl
          });
        }
      } catch (error) {
        this.logger.error("Error processing link for storage", {
          error,
          url,
          pageUrl
        });
      }
    }

    this.logger.info("Completed storing links", {
      totalAttempted: links.length,
      successfullyStored: storedLinks.length,
      storedLinks: storedLinks.map(link => ({
        id: link.id,
        url: link.extracted_link,
        isInternal: link.is_internal
      }))
    });

    return storedLinks;
  }

  /**
   * Create source_links entries
   */
  private async createSourceLinks(
    links: Link[],
    sourceId: number,
    dataId?: string
  ): Promise<void> {
    const sourceLinkInserts: SourceLinkInsert[] = links.map(link => ({
      source_id: sourceId,
      link_id: link.id,
      data_id: dataId || '', // Convert undefined to empty string to satisfy type
    }));

    const { error } = await this.supabase
      .from("source_links")
      .upsert(sourceLinkInserts, {
        onConflict: "source_id,link_id",
      });

    if (error) {
      this.logger.error("Failed to create source links", {
        error,
        sourceId,
        dataId,
        linkCount: links.length,
      });
      throw error;
    }
  }

  /**
   * Check link status and store results with retry mechanism
   */
  async validateLink(link: Link): Promise<LinkValidationResult> {
    try {
      // Add debug logging
      this.logger.debug('Starting link validation', {
        linkId: link.id,
        url: link.extracted_link
      });

      // Validate the link using our specialized fetch
      const response = await validateLinkFetch({
        url: link.extracted_link,
        logger: this.logger,
        tryCount: this.options.maxRetries || 3,
        timeout: this.options.requestTimeout || 30000
      });

      if (!response) {
        const result: LinkValidationResult = {
          url: link.extracted_link,
          statusCode: 500,
          error: 'Failed to validate link'
        };
        await this.updateLinkStatus(link.id, result);
        return result;
      }

      // Handle redirects
      const location = response.headers.get('location');
      let finalUrl: string | undefined;
      let redirectType: string | undefined;

      if (response.status >= 300 && response.status < 400 && location) {
        // Resolve relative redirect URLs
        try {
          const resolvedUrl = new URL(location, link.extracted_link).href;
          if (resolvedUrl !== link.extracted_link) {
            finalUrl = resolvedUrl;
            redirectType = this.getRedirectType(response.status);
          }
          
          this.logger.debug('Redirect chain detected', {
            originalUrl: link.extracted_link,
            redirectUrl: finalUrl,
            statusCode: response.status,
            redirectType
          });
        } catch (urlError) {
          this.logger.error('Failed to resolve redirect URL', {
            originalUrl: link.extracted_link,
            location,
            error: urlError
          });
        }
      }

      const result: LinkValidationResult = {
        url: link.extracted_link,
        statusCode: response.status,
        redirectUrl: finalUrl,
        redirectType
      };

      // Store redirect info if we have one
      if (result.redirectUrl && result.redirectType) {
        try {
          await this.storeRedirect(link.id, result);
          this.logger.debug('Stored redirect information', {
            linkId: link.id,
            fromUrl: result.url,
            toUrl: result.redirectUrl,
            type: result.redirectType
          });
        } catch (redirectError) {
          this.logger.error('Failed to store redirect', {
            error: redirectError,
            linkId: link.id,
            result
          });
        }
      }

      // Update link status in database
      await this.updateLinkStatus(link.id, result);

      // If validation was successful (2xx status code), index the page in Pinecone
      if (result.statusCode >= 200 && result.statusCode < 300) {
        try {
          // Extract title and description from response body if available
          let title = '';
          let description = '';
          if (response.body) {
            const titleMatch = response.body.match(/<title>(.*?)<\/title>/i);
            const descMatch = response.body.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
            title = titleMatch ? titleMatch[1] : '';
            description = descMatch ? descMatch[1] : '';
          }

          // Index the page in Pinecone
          await indexPage({
            document: {
              metadata: {
                url: result.url,
                title,
                description,
                sourceURL: result.url,
                statusCode: result.statusCode
              },
              markdown: response.body || ''  // Include the page content if available
            },
            originUrl: result.url,
            crawlId: link.id.toString(),
            teamId: this.options.projectId.toString()
          });

          this.logger.debug('Successfully indexed page in Pinecone', {
            linkId: link.id,
            url: result.url
          });
        } catch (indexError) {
          this.logger.error('Failed to index page in Pinecone', {
            error: indexError,
            linkId: link.id,
            url: result.url
          });
          // Don't fail the validation if indexing fails
        }
      }

      this.logger.debug('Link validation completed', { result });

      return result;

    } catch (error) {
      this.logger.error('Error validating link', {
        linkId: link.id,
        url: link.extracted_link,
        error
      });

      const result: LinkValidationResult = {
        url: link.extracted_link,
        statusCode: this.getErrorStatusCode(error),
        error: error.message
      };

      // Update link status even if validation failed
      await this.updateLinkStatus(link.id, result);

      return result;
    }
  }

  /**
   * Update link status in database
   */
  private async updateLinkStatus(
    linkId: number, 
    result: LinkValidationResult
  ): Promise<void> {
    const { error } = await this.supabase
      .from("links")
      .update({
        status_code: result.statusCode,
        last_checked: new Date().toISOString()
      })
      .eq("id", linkId);

    if (error) {
      this.logger.error("Failed to update link status", {
        error,
        linkId,
        result
      });
      throw error;
    }
  }

  /**
   * Get redirect type based on status code
   */
  private getRedirectType(statusCode: number): string {
    switch (statusCode) {
      case 301:
        return "permanent";
      case 302:
        return "temporary";
      case 303:
        return "see-other";
      case 307:
        return "temporary-strict";
      case 308:
        return "permanent-strict";
      default:
        return "unknown";
    }
  }

  /**
   * Map common errors to HTTP status codes
   */
  private getErrorStatusCode(error: any): number {
    if (error.name === "AbortError" || error.message.includes("timeout")) {
      return 408; // Request Timeout
    }
    if (error.code === "ENOTFOUND") {
      return 404; // Not Found
    }
    if (error.code === "ECONNREFUSED") {
      return 503; // Service Unavailable
    }
    if (error.code === "CERT_HAS_EXPIRED") {
      return 525; // SSL Handshake Failed
    }
    return 500; // Internal Server Error
  }

  /**
   * Store link redirect information
   */
  private async storeRedirect(
    linkId: number,
    redirectInfo: LinkValidationResult
  ): Promise<void> {
    if (!redirectInfo.redirectUrl) return;

    const redirectInsert: LinkRedirectInsert = {
      link_id: linkId,
      original_url: redirectInfo.url,
      redirected_url: redirectInfo.redirectUrl,
      status_code: redirectInfo.statusCode,
      redirect_type: redirectInfo.redirectType,
    };

    const { error } = await this.supabase
      .from("link_redirects")
      .upsert([redirectInsert], {
        onConflict: "link_id,original_url,redirected_url",
      });

    if (error) {
      this.logger.error("Failed to store redirect", {
        error,
        linkId,
        redirectInfo,
      });
      throw error;
    }
  }

  /**
   * Get broken links for a project
   */
  async getBrokenLinks(): Promise<Link[]> {
    this.logger.debug("Fetching broken links", {
      projectId: this.options.projectId,
      statusCodes: [404, 500, 502, 503, 504]
    });

    const { data, error } = await this.supabase
      .from("links")
      .select()
      .eq("project_id", this.options.projectId)
      .in("status_code", [404, 500, 502, 503, 504]) as PostgrestResponse<Link>;

    if (error) {
      this.logger.error("Failed to get broken links", {
        error,
        projectId: this.options.projectId,
      });
      throw error;
    }

    this.logger.info("Retrieved broken links", {
      projectId: this.options.projectId,
      brokenLinkCount: data?.length || 0,
      brokenUrls: data?.map(link => ({
        id: link.id,
        url: link.extracted_link,
        statusCode: link.status_code
      }))
    });

    return data || [];
  }

  /**
   * Sleep function for rate limiting
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate delay needed based on rate limit options
   */
  private calculateDelay(rateLimit: RateLimitOptions, batchSize: number): number {
    if (rateLimit.maxRequestsPerMinute) {
      // Calculate minimum delay needed to stay under rate limit
      const minDelayBetweenRequests = (60 * 1000) / rateLimit.maxRequestsPerMinute;
      return minDelayBetweenRequests * batchSize;
    }
    return rateLimit.delayBetweenBatches || 1000; // Default 1 second delay
  }

  /**
   * Validate links in batches with rate limiting
   */
  async validateLinksBatch(links: Link[], batchSize: number = 10): Promise<LinkValidationResult[]> {
    // Add debug logging for batch processing
    this.logger.info("Starting batch link validation", {
      totalLinks: links.length,
      batchSize,
      estimatedBatches: Math.ceil(links.length / batchSize),
      urls: links.map(link => ({
        id: link.id,
        url: link.extracted_link,
        pageUrl: link.page_url
      }))
    });

    const results: LinkValidationResult[] = [];
    const batches = Math.ceil(links.length / batchSize);

    for (let i = 0; i < links.length; i += batchSize) {
      const batchNumber = Math.floor(i / batchSize) + 1;
      const batch = links.slice(i, i + batchSize);
      
      this.logger.info(`Processing batch ${batchNumber}/${batches}`, {
        batchUrls: batch.map(link => ({
          id: link.id,
          url: link.extracted_link,
          pageUrl: link.page_url
        }))
      });
      
      // Process current batch
      const batchResults = await Promise.all(
        batch.map(async (link) => {
          try {
            const result = await this.validateLink(link);
            results.push(result);
            this.logger.debug("Link validation result", {
              linkId: link.id,
              url: link.extracted_link,
              statusCode: result.statusCode,
              redirectUrl: result.redirectUrl,
              error: result.error
            });
            return { success: true, link, result };
          } catch (error) {
            this.logger.error("Failed to validate link in batch", {
              linkId: link.id,
              url: link.extracted_link,
              error: error.message,
              stack: error.stack
            });
            return { success: false, link, error };
          }
        })
      );

      // Calculate success rate for this batch
      const successfulResults = batchResults.filter(r => r.success);
      const batchSuccessRate = successfulResults.length / batch.length;
      
      this.logger.info(`Batch ${batchNumber}/${batches} completed`, {
        successRate: `${(batchSuccessRate * 100).toFixed(1)}%`,
        failedCount: batch.length - successfulResults.length,
        results: batchResults.map(r => ({
          url: r.link.extracted_link,
          success: r.success,
          statusCode: r.success && r.result ? r.result.statusCode : undefined,
          error: !r.success && r.error ? r.error.message : undefined
        }))
      });

      // Apply rate limiting delay if not the last batch
      if (i < links.length - batchSize && this.options.rateLimit) {
        const delay = this.calculateDelay(this.options.rateLimit, batchSize);
        this.logger.debug(`Rate limiting: waiting ${delay}ms before next batch`);
        await this.delay(delay);
      }
    }

    // Log batch validation summary with detailed results
    this.logger.info("Batch link validation completed", {
      totalProcessed: links.length,
      successCount: results.length,
      failureCount: links.length - results.length,
      successRate: `${((results.length / links.length) * 100).toFixed(1)}%`,
      results: results.map(result => ({
        url: result.url,
        statusCode: result.statusCode,
        redirectUrl: result.redirectUrl,
        error: result.error
      }))
    });

    return results;
  }

  /**
   * Get all unvalidated links for a project
   */
  async getUnvalidatedLinks(): Promise<Link[]> {
    this.logger.info("Fetching unvalidated links", {
      projectId: this.options.projectId
    });

    const { data, error } = await this.supabase
      .from("links")
      .select("*")
      .eq("project_id", this.options.projectId)
      .is("status_code", null);

    if (error) {
      this.logger.error("Failed to get unvalidated links", {
        error,
        projectId: this.options.projectId
      });
      throw error;
    }

    this.logger.info("Retrieved unvalidated links", {
      count: data?.length || 0,
      urls: data?.map(link => ({
        id: link.id,
        url: link.extracted_link,
        pageUrl: link.page_url
      }))
    });

    return data || [];
  }

  /**
   * Validate all unvalidated links for a project
   */
  async validateAllLinks(batchSize: number = 10): Promise<LinkValidationResult[]> {
    this.logger.info("Starting validation of all unvalidated links");
    
    const unvalidatedLinks = await this.getUnvalidatedLinks();
    
    this.logger.info("Retrieved unvalidated links for processing", {
      linkCount: unvalidatedLinks.length,
      batchSize,
      urls: unvalidatedLinks.map(link => ({
        id: link.id,
        url: link.extracted_link,
        pageUrl: link.page_url
      }))
    });

    if (unvalidatedLinks.length === 0) {
      this.logger.info("No unvalidated links found");
      return [];
    }

    return this.validateLinksBatch(unvalidatedLinks, batchSize);
  }

  /**
   * Find alternative URLs for broken links
   */
  async findAlternativesForBrokenLinks(): Promise<Map<string, string[]>> {
    const alternatives = new Map<string, string[]>();

    try {
      this.logger.debug('Starting search for broken links...');

      // Get broken links
      const { data: brokenLinks, error } = await this.supabase
        .from('links')
        .select('*')
        .eq('project_id', this.options.projectId)
        .eq('status_code', 404)
        .is('suggested_alternative', null);

      if (error) {
        this.logger.error('Failed to fetch broken links', { error });
        return alternatives;
      }

      this.logger.debug('Found broken links', {
        count: brokenLinks?.length || 0,
        links: brokenLinks?.map(l => l.extracted_link)
      });

      if (!brokenLinks?.length) {
        this.logger.debug('No broken links found needing alternatives');
        return alternatives;
      }

      // Initialize AlternativeUrlService if needed
      if (!this.alternativeUrlService && this.options.alternativeUrlOptions) {
        this.logger.debug('Initializing AlternativeUrlService');
        this.alternativeUrlService = new AlternativeUrlService(
          this.supabase,
          {
            ...this.options.alternativeUrlOptions,
            projectId: this.options.projectId
          }
        );
      }

      if (!this.alternativeUrlService) {
        this.logger.warn('AlternativeUrlService not available');
        return alternatives;
      }

      // Process each broken link
      for (const link of brokenLinks) {
        this.logger.debug('Processing broken link', {
          url: link.extracted_link,
          anchorText: link.anchor_text
        });

        try {
          const result = await this.alternativeUrlService.findAlternativeUrls(
            link.extracted_link,
            {
              title: link.anchor_text,
              description: link.description
            }
          );

          this.logger.debug('Alternative URLs found', {
            originalUrl: link.extracted_link,
            alternativesCount: result.alternativeUrls.length,
            alternatives: result.alternativeUrls
          });

          if (result.alternativeUrls.length > 0) {
            // Store the best alternative
            const bestAlternative = result.alternativeUrls[0];
            
            this.logger.debug('Updating link with best alternative', {
              originalUrl: link.extracted_link,
              bestAlternative: bestAlternative.url,
              score: bestAlternative.score
            });

            const { error: updateError } = await this.supabase
              .from('links')
              .update({
                suggested_alternative: bestAlternative.url,
                last_checked: new Date().toISOString()
              })
              .eq('id', link.id);

            if (updateError) {
              this.logger.error('Failed to update link with alternative', {
                error: updateError,
                linkId: link.id
              });
            } else {
              alternatives.set(
                link.extracted_link,
                result.alternativeUrls.map(alt => alt.url)
              );
            }
          } else {
            this.logger.debug('No alternatives found for link', {
              url: link.extracted_link
            });
          }
        } catch (error) {
          this.logger.error('Error processing alternative URLs for link', {
            error,
            url: link.extracted_link
          });
        }

        // Add a small delay between processing links
        await this.delay(500);
      }

      this.logger.info('Completed alternative URL search', {
        processedLinks: brokenLinks.length,
        alternativesFound: alternatives.size
      });

      return alternatives;
    } catch (error) {
      this.logger.error('Failed to process alternative URLs', { error });
      return alternatives;
    }
  }

  /**
   * Update suggested alternatives for all broken links
   */
  async updateAllSuggestedAlternatives(batchSize: number = 10): Promise<void> {
    this.logger.info("Starting update of suggested alternatives");

    try {
      // Get all broken links
      const brokenLinks = await this.getBrokenLinks();
      
      // Process in batches
      const batches: Link[][] = [];
      for (let i = 0; i < brokenLinks.length; i += batchSize) {
        batches.push(brokenLinks.slice(i, i + batchSize));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.debug(`Processing batch ${i + 1}/${batches.length}`, {
          batchSize: batch.length
        });

        await Promise.all(
          batch.map(async (link) => {
            try {
              if (!this.alternativeUrlService) return;

              const result = await this.alternativeUrlService.findAlternativeUrls(
                link.extracted_link,
                { title: link.anchor_text || undefined }
              );

              if (result.alternativeUrls.length > 0) {
                await this.supabase
                  .from("links")
                  .update({
                    suggested_alternative: result.alternativeUrls[0].url,
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", link.id);
              }
            } catch (error) {
              this.logger.error("Failed to update suggested alternative", {
                error,
                linkId: link.id,
                url: link.extracted_link
              });
            }
          })
        );

        // Add delay between batches if rate limiting is configured
        if (i < batches.length - 1 && this.options.rateLimit) {
          const delay = this.calculateDelay(this.options.rateLimit, batchSize);
          await this.delay(delay);
        }
      }

      this.logger.info("Completed update of suggested alternatives", {
        processedLinks: brokenLinks.length
      });
    } catch (error) {
      this.logger.error("Failed to update suggested alternatives", {
        error
      });
      throw error;
    }
  }
} 