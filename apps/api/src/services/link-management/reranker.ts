import { CohereClient } from 'cohere-ai';
import { logger } from '../../lib/logger';
import { CohereRateLimiter } from './cohere-rate-limiter';

export class Reranker {
  private client: CohereClient;
  private rateLimiter: CohereRateLimiter;

  constructor(apiKey: string) {
    this.client = new CohereClient({ token: apiKey });
    this.rateLimiter = new CohereRateLimiter();
  }

  private preprocessQuery(query: string): string {
    // Skip preprocessing if query is empty
    if (!query || !query.trim()) {
      return query;
    }

    // Remove protocol and common URL parts
    const cleanedQuery = query
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .replace(/[_-]/g, ' ')
      .toLowerCase();

    // Extract meaningful parts from path
    const pathParts = cleanedQuery.split('/').filter(Boolean);
    
    // Join with spaces and remove common URL words
    const processed = pathParts
      .join(' ')
      .replace(/www\.|\.com|\.org|\.net/g, '')
      .trim();

    // Return original query if processed version is empty
    return processed || query;
  }

  async rerankDocuments(
    documents: string[],
    query: string,
    topN = 3,
    model = 'rerank-english-v2.0',
  ): Promise<{ document: string; relevanceScore: number }[]> {
    if (!documents.length) {
      logger.debug('No documents provided for reranking');
      return [];
    }

    // Return documents without reranking if query is empty
    if (!query || !query.trim()) {
      logger.debug('Empty query provided, returning documents without reranking');
      return documents.map(doc => ({
        document: doc,
        relevanceScore: 1.0
      }));
    }

    try {
      const processedQuery = this.preprocessQuery(query);
      logger.debug('Reranking documents:', { 
        documentCount: documents.length,
        processedQuery,
        originalQuery: query,
        rawDocuments: documents.slice(0, 5) // Log first 5 docs for debugging
      });

      // Format documents for reranking
      const formattedDocs = documents.map((doc, index) => {
        try {
          let parsedDoc;
          try {
            parsedDoc = JSON.parse(doc);
          } catch {
            // If not JSON, assume it's a plain string
            parsedDoc = { url: doc };
          }

          // Ensure we have at least a URL
          if (!parsedDoc.url) {
            logger.warn(`Document ${index} has no URL`, { document: doc });
            return null;
          }

          const formatted = {
            url: parsedDoc.url,
            title: parsedDoc.title || '',
            description: parsedDoc.description || ''
          };

          logger.debug(`Formatted document ${index}:`, { 
            original: doc,
            formatted,
            isValidJSON: parsedDoc !== null
          });

          return `URL: ${formatted.url}${formatted.title ? `\nTitle: ${formatted.title}` : ''}${formatted.description ? `\nDescription: ${formatted.description}` : ''}`;
        } catch (e) {
          logger.warn(`Failed to process document ${index}:`, { 
            document: doc,
            error: e 
          });
          return null;
        }
      }).filter((doc): doc is string => doc !== null);

      if (formattedDocs.length === 0) {
        logger.warn('No valid documents after formatting');
        return [];
      }

      logger.debug('Formatted documents for reranking:', {
        count: formattedDocs.length,
        samples: formattedDocs.slice(0, 3) // Log first 3 formatted docs
      });

      // Make the reranking request
      logger.debug('Making reranking request to Cohere:', {
        query: processedQuery,
        model,
        topN,
        documentCount: formattedDocs.length
      });

      const response = await this.rateLimiter.enqueue(() => 
        this.client.rerank({
          documents: formattedDocs,
          query: processedQuery,
          topN: Math.min(topN, formattedDocs.length),
          model,
        })
      );

      logger.debug('Raw Cohere response:', {
        results: response.results.map(r => ({
          index: r.index,
          relevanceScore: r.relevanceScore,
          document: r.document ? String(r.document).substring(0, 100) : null
        }))
      });

      // Process and log results
      const results = response.results.map(result => {
        const doc = result.document ? String(result.document) : formattedDocs[result.index];
        const urlMatch = doc.match(/URL:\s*([^\n]+)/);
        const url = urlMatch ? urlMatch[1].trim() : doc;
        
        return {
          document: url,
          relevanceScore: result.relevanceScore,
        };
      });

      logger.debug('Reranking results:', {
        totalResults: results.length,
        results: results.map(r => ({
          url: r.document,
          score: r.relevanceScore,
          passesThreshold: r.relevanceScore >= 0.1
        }))
      });
      
      return results;

    } catch (error) {
      logger.error('Error reranking documents:', {
        error,
        query,
        documentsCount: documents.length
      });
      throw error;
    }
  }
} 