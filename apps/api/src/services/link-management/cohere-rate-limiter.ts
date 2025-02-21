import { logger } from '../../lib/logger';

export class CohereRateLimiter {
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessing = false;
  private lastRequestTime = 0;
  private readonly requestsPerMinute: number;
  private readonly minDelayBetweenRequests: number;

  constructor(requestsPerMinute = 10) { // Default to 10 requests per minute for trial API
    this.requestsPerMinute = requestsPerMinute;
    this.minDelayBetweenRequests = (60 * 1000) / requestsPerMinute; // Convert to milliseconds between requests
  }

  async enqueue<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await this.executeWithRetry(request);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private async executeWithRetry<T>(
    request: () => Promise<T>,
    retries = 3,
    baseDelay = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await request();
      } catch (error: any) {
        if (error?.statusCode === 429 && attempt < retries) {
          const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
          logger.warn(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  private async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      const timeToWait = Math.max(0, this.minDelayBetweenRequests - timeSinceLastRequest);

      if (timeToWait > 0) {
        await new Promise(resolve => setTimeout(resolve, timeToWait));
      }

      const request = this.requestQueue.shift();
      if (request) {
        this.lastRequestTime = Date.now();
        try {
          await request();
        } catch (error) {
          logger.error('Error processing request in queue:', error);
        }
      }
    }

    this.isProcessing = false;
  }
} 