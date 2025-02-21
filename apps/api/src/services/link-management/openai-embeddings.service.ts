import { OpenAI } from 'openai';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../supabase_types';
import { logger as _logger } from '../../lib/logger';

interface OpenAIEmbeddingsConfig {
  apiKey: string;
  model?: string;
  batchSize?: number;
  rateLimit?: {
    requestsPerMinute?: number;
    maxConcurrent?: number;
    retryDelay?: number;
  };
}

export class OpenAIEmbeddingsService {
  private readonly logger = _logger.child({
    module: 'link-management',
    service: 'OpenAIEmbeddingsService',
  });

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly batchSize: number;
  
  // Rate limiting properties
  private readonly requestsPerMinute: number;
  private readonly maxConcurrent: number;
  private readonly retryDelay: number;
  private tokenBucket: number;
  private lastRefill: number;
  private activeRequests: number;

  constructor(
    private readonly supabase: SupabaseClient<Database>,
    config: OpenAIEmbeddingsConfig
  ) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true // Since we're running server-side
    });
    this.model = config.model || 'text-embedding-3-small';
    this.batchSize = config.batchSize || 100;

    // Initialize rate limiting
    this.requestsPerMinute = config.rateLimit?.requestsPerMinute || 200; // Default to 200 RPM
    this.maxConcurrent = config.rateLimit?.maxConcurrent || 10;
    this.retryDelay = config.rateLimit?.retryDelay || 1000;
    this.tokenBucket = this.requestsPerMinute;
    this.lastRefill = Date.now();
    this.activeRequests = 0;
  }

  /**
   * Refill the token bucket based on time elapsed
   */
  private refillTokenBucket(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor((timePassed / 60000) * this.requestsPerMinute);

    if (tokensToAdd > 0) {
      this.tokenBucket = Math.min(this.requestsPerMinute, this.tokenBucket + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Check if we can make a request and consume a token if available
   */
  private async acquireToken(): Promise<boolean> {
    this.refillTokenBucket();

    if (this.tokenBucket > 0 && this.activeRequests < this.maxConcurrent) {
      this.tokenBucket--;
      this.activeRequests++;
      return true;
    }

    return false;
  }

  /**
   * Release a token back to the bucket
   */
  private releaseToken(): void {
    this.activeRequests--;
  }

  /**
   * Wait for a token to become available
   */
  private async waitForToken(): Promise<void> {
    while (!(await this.acquireToken())) {
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
    }
  }

  /**
   * Generate embeddings for a single text with rate limiting
   */
  async embedText(text: string): Promise<number[]> {
    try {
      await this.waitForToken();

      const response = await this.client.embeddings.create({
        model: this.model,
        input: this.preprocessText(text)
      });

      return response.data[0].embedding;
    } catch (error) {
      this.logger.error('Failed to generate embedding', {
        error,
        text: text.substring(0, 100)
      });
      throw error;
    } finally {
      this.releaseToken();
    }
  }

  /**
   * Generate embeddings for multiple texts in batches with rate limiting
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    try {
      const batches = this.chunkArray(texts, this.batchSize);
      const embeddings: number[][] = [];

      for (const batch of batches) {
        await this.waitForToken();

        try {
          const response = await this.client.embeddings.create({
            model: this.model,
            input: batch.map(this.preprocessText)
          });

          embeddings.push(...response.data.map(d => d.embedding));

          // Log progress
          this.logger.debug('Batch embedding completed', {
            batchSize: batch.length,
            totalProcessed: embeddings.length,
            remaining: texts.length - embeddings.length
          });

        } catch (error) {
          this.logger.error('Failed to generate embeddings for batch', {
            error,
            batchSize: batch.length
          });
          throw error;
        } finally {
          this.releaseToken();
        }

        // Add a small delay between batches
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return embeddings;
    } catch (error) {
      this.logger.error('Failed to generate embeddings batch', {
        error,
        textCount: texts.length
      });
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
    // If embeddings have different dimensions, use the smaller one
    const minLength = Math.min(embedding1.length, embedding2.length);
    const e1 = embedding1.slice(0, minLength);
    const e2 = embedding2.slice(0, minLength);

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < minLength; i++) {
      dotProduct += e1[i] * e2[i];
      norm1 += e1[i] * e1[i];
      norm2 += e2[i] * e2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Preprocess text before generating embeddings
   */
  private preprocessText(text: string): string {
    return text
      .replace(/\n/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim(); // Remove leading/trailing whitespace
  }

  /**
   * Split array into chunks of specified size
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
} 