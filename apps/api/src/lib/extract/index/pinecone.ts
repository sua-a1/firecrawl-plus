import { Pinecone } from "@pinecone-database/pinecone";
import { Document } from "../../../controllers/v1/types";
import { logger } from "../../logger";
import OpenAI from "openai";

// Check required environment variables
if (!process.env.PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY is required for Pinecone');
}

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || "firecrawl-links";

const MAX_METADATA_SIZE = 30 * 1024; // 30KB in bytes

export interface PageMetadata {
  url: string;
  originUrl: string;
  domain: string;
  title?: string;
  description?: string;
  crawlId?: string;
  teamId?: string;
  timestamp: number;
  markdown?: string;
}

async function getEmbedding(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for embeddings');
  }

  const openai = new OpenAI({
    apiKey: apiKey,
  });
  
  const embedding = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL_NAME || "text-embedding-3-small",
    input: text,
    encoding_format: "float",
  });

  return embedding.data[0].embedding;
}

function normalizeUrl(url: string) {
  // Add https:// if no protocol is present
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  const urlO = new URL(url);
  if (!urlO.hostname.startsWith("www.")) {
    urlO.hostname = "www." + urlO.hostname;
  }
  return urlO.href;
}

export async function indexPage({
  document,
  originUrl,
  crawlId,
  teamId,
}: {
  document: Document;
  originUrl: string;
  crawlId?: string;
  teamId?: string;
}) {
  try {
    logger.debug('Starting page indexing:', {
      url: document.metadata.sourceURL || document.metadata.url,
      originUrl,
      crawlId,
      teamId
    });

    const index = pinecone.index(INDEX_NAME);

    // Trim markdown if it's too long
    let trimmedMarkdown = document.markdown || '';
    if (
      trimmedMarkdown &&
      Buffer.byteLength(trimmedMarkdown, "utf-8") > MAX_METADATA_SIZE
    ) {
      trimmedMarkdown = trimmedMarkdown.slice(
        0,
        Math.floor(MAX_METADATA_SIZE / 2),
      );
      logger.debug('Trimmed markdown to fit size limit', {
        originalSize: Buffer.byteLength(document.markdown || '', "utf-8"),
        newSize: Buffer.byteLength(trimmedMarkdown, "utf-8")
      });
    }

    // Create text to embed
    const textToEmbed = [
      document.metadata.title,
      document.metadata.description,
      trimmedMarkdown,
    ]
      .filter(Boolean)
      .join("\n\n");

    logger.debug('Created text to embed:', {
      hasTitle: !!document.metadata.title,
      hasDescription: !!document.metadata.description,
      hasMarkdown: !!trimmedMarkdown,
      textLength: textToEmbed.length
    });

    // Get embedding from OpenAI
    logger.debug('Getting embedding from OpenAI...');
    const embedding = await getEmbedding(textToEmbed);
    logger.debug('Successfully got embedding', {
      dimensions: embedding.length
    });

    const normalizedUrl = normalizeUrl(
      document.metadata.sourceURL || document.metadata.url!,
    );

    // Extract domain from normalized URL
    const domain = new URL(normalizedUrl).hostname;

    // Prepare metadata
    const metadata: PageMetadata = {
      url: normalizedUrl,
      originUrl: normalizeUrl(originUrl),
      domain: domain,
      title: document.metadata.title ?? document.metadata.ogTitle ?? "",
      description:
        document.metadata.description ?? document.metadata.ogDescription ?? "",
      crawlId,
      teamId,
      markdown: trimmedMarkdown,
      timestamp: Date.now(),
    };

    logger.debug('Prepared metadata for indexing:', {
      url: metadata.url,
      originUrl: metadata.originUrl,
      domain: metadata.domain,
      hasTitle: !!metadata.title,
      hasDescription: !!metadata.description
    });

    // Upsert to Pinecone
    logger.debug('Upserting to Pinecone...');
    await index.upsert([
      {
        id: normalizedUrl,
        values: embedding,
        metadata: {
          ...metadata,
          [document.metadata.sourceURL || document.metadata.url!]: true,
        },
      },
    ]);

    logger.info("Successfully indexed page in Pinecone", {
      url: metadata.url,
      crawlId,
      domain: metadata.domain
    });
  } catch (error) {
    logger.error("Failed to index page in Pinecone", {
      error,
      url: document.metadata.sourceURL || document.metadata.url,
      crawlId,
    });
    throw error; // Re-throw to handle the error in the calling code
  }
}

export async function searchSimilarPages(
  query: string,
  originUrl?: string,
  limit: number = 1000,
): Promise<any[]> {
  try {
    logger.debug('Starting Pinecone search:', {
      query,
      queryLength: query.length,
      originUrl,
      limit,
      indexName: INDEX_NAME
    });

    const index = pinecone.index(INDEX_NAME);

    // Get query embedding from OpenAI
    logger.debug('Getting embedding for query...');
    const queryEmbedding = await getEmbedding(query);
    logger.debug('Successfully got query embedding', {
      dimensions: queryEmbedding.length
    });

    const queryParams: any = {
      vector: queryEmbedding,
      topK: limit,
      includeMetadata: true,
      includeValues: false
    };

    // Only filter by originUrl if it's from the same domain
    const normalizedOriginUrl = originUrl ? normalizeUrl(originUrl) : undefined;
    if (normalizedOriginUrl) {
      try {
        const originDomain = new URL(normalizedOriginUrl).hostname;
        // Use a more lenient filter - just match the domain
        queryParams.filter = { domain: { $eq: originDomain } };
        logger.debug('Using domain filter:', { 
          originDomain,
          normalizedOriginUrl
        });
      } catch (error) {
        logger.warn('Failed to parse origin URL for filtering', { error, normalizedOriginUrl });
      }
    } else {
      logger.debug('No origin URL provided, searching without domain filter');
    }

    logger.debug('Querying Pinecone with params:', {
      ...queryParams,
      vector: `${queryEmbedding.length} dimensions`
    });

    const results = await index.query(queryParams);
    
    logger.debug('Raw Pinecone results:', {
      matchCount: results.matches.length,
      scores: results.matches.map(m => m.score),
      urls: results.matches.map(m => m.metadata?.url),
      domains: results.matches.map(m => m.metadata?.domain)
    });

    // Lower the minimum score threshold and make filtering more lenient
    const MIN_SCORE = 0.3; // Reduced from 0.5
    const mappedResults = results.matches
      .map((match) => {
        const result = {
          url: match.metadata?.url,
          title: match.metadata?.title,
          description: match.metadata?.description,
          score: match.score || 0,
          markdown: match.metadata?.markdown,
        };
        
        logger.debug('Processing match:', {
          url: result.url,
          score: result.score,
          hasTitle: !!result.title,
          hasDescription: !!result.description,
          meetsScoreThreshold: result.score >= MIN_SCORE
        });
        
        return result;
      })
      .filter(result => {
        // Only filter out results with no URL or extremely low scores
        const isValid = !!result.url && result.score >= MIN_SCORE;
        if (!isValid) {
          logger.debug('Filtering out result:', {
            url: result.url,
            score: result.score,
            reason: !result.url ? 'missing URL' : 'score below threshold'
          });
        }
        return isValid;
      });

    logger.info('Search results:', {
      query,
      totalMatches: results.matches.length,
      filteredResults: mappedResults.length,
      topScores: mappedResults.slice(0, 3).map(r => ({
        url: r.url,
        score: r.score
      }))
    });

    return mappedResults;
  } catch (error) {
    logger.error("Failed to search similar pages in Pinecone", {
      error,
      query,
      originUrl,
    });
    return [];
  }
}
