import { Queue, QueueEvents } from "bullmq";
import { logger } from "../lib/logger";
import IORedis from "ioredis";
import { EventEmitter } from 'events';
import { logger as _logger } from '../lib/logger';

export type QueueFunction = () => Queue<any, any, string>;

let scrapeQueue: Queue<any, any, string>;
let extractQueue: Queue<any, any, string>;
let loggingQueue: Queue<any, any, string>;
let indexQueue: Queue<any, any, string>;
let deepResearchQueue: Queue<any, any, string>;
let generateLlmsTxtQueue: Queue<any, any, string>;
let summarizationQueue: Queue<any, any, string> | InMemoryQueue;

export const redisConnection = new IORedis(process.env.REDIS_URL!, {
  retryStrategy(times) {
    const delay = Math.min(times * 1000, 5000);
    _logger.info(`Retrying Redis connection in ${delay}ms (attempt ${times})`);
    return delay;
  },
  reconnectOnError(err) {
    _logger.warn('Redis connection error, attempting reconnect', { error: err.message });
    return true;
  },
  enableReadyCheck: true,
  maxRetriesPerRequest: null, // Required by BullMQ
  connectTimeout: 20000,
  disconnectTimeout: 20000
});

redisConnection.on('error', (error) => {
  logger.error('Redis connection error', { error: error.message });
});

redisConnection.on('connect', () => {
  logger.info('Redis connected successfully');
});

redisConnection.on('ready', () => {
  logger.info('Redis client ready');
});

redisConnection.on('reconnecting', () => {
  logger.info('Redis client reconnecting');
});

export const scrapeQueueName = "{scrapeQueue}";
export const extractQueueName = "{extractQueue}";
export const loggingQueueName = "{loggingQueue}";
export const indexQueueName = "{indexQueue}";
export const generateLlmsTxtQueueName = "{generateLlmsTxtQueue}";
export const deepResearchQueueName = "{deepResearchQueue}";
export const summarizationQueueName = "{summarizationQueue}";

export function getScrapeQueue() {
  if (!scrapeQueue) {
    scrapeQueue = new Queue(scrapeQueueName, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600, // 1 hour
        },
        removeOnFail: {
          age: 3600, // 1 hour
        },
      },
    });
    logger.info("Web scraper queue created");
  }
  return scrapeQueue;
}

export function getExtractQueue() {
  if (!extractQueue) {
    extractQueue = new Queue(extractQueueName, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 90000, // 25 hours
        },
        removeOnFail: {
          age: 90000, // 25 hours
        },
      },
    });
    logger.info("Extraction queue created");
  }
  return extractQueue;
}

export function getIndexQueue() {
  if (!indexQueue) {
    indexQueue = new Queue(indexQueueName, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 90000, // 25 hours
        },
        removeOnFail: {
          age: 90000, // 25 hours
        },
      },
    });
    logger.info("Index queue created");
  }
  return indexQueue;
}

export function getGenerateLlmsTxtQueue() {
  if (!generateLlmsTxtQueue) {
    generateLlmsTxtQueue = new Queue(generateLlmsTxtQueueName, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 90000, // 25 hours
        },
        removeOnFail: {
          age: 90000, // 25 hours
        },
      },
    });
    logger.info("LLMs TXT generation queue created");
  }
  return generateLlmsTxtQueue;
}

export function getDeepResearchQueue() {
  if (!deepResearchQueue) {
    deepResearchQueue = new Queue(deepResearchQueueName, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 90000, // 25 hours
        },
        removeOnFail: {
          age: 90000, // 25 hours
        },
      },
    });
    logger.info("Deep research queue created");
  }
  return deepResearchQueue;
}

export function getSummarizationQueue() {
  if (!summarizationQueue) {
    // Use in-memory queue for summarization
    summarizationQueue = new InMemoryQueue(summarizationQueueName);
    logger.info("In-memory summarization queue created");
  }
  return summarizationQueue;
}

// === REMOVED IN FAVOR OF POLLING -- NOT RELIABLE
// import { QueueEvents } from 'bullmq';
// export const scrapeQueueEvents = new QueueEvents(scrapeQueueName, { connection: redisConnection.duplicate() });

export class InMemoryQueue extends EventEmitter {
  private jobs: Map<string, any>;
  private isProcessing: boolean;
  name: string;

  constructor(name: string) {
    super();
    this.name = name;
    this.jobs = new Map();
    this.isProcessing = false;
  }

  async add(name: string, data: any): Promise<{ id: string }> {
    const jobId = Math.random().toString(36).substring(7);
    const job = { id: jobId, name, data };
    this.jobs.set(jobId, job);
    
    // Log job addition
    _logger.debug('Added job to in-memory queue', { jobId, name });
    
    this.emit('active', job);
    this.processNext();
    return job;
  }

  private async processNext() {
    if (this.isProcessing || this.jobs.size === 0) return;
    
    this.isProcessing = true;
    const [jobId, job] = this.jobs.entries().next().value;
    
    try {
      // Log processing start
      _logger.debug('Processing job from in-memory queue', { jobId });
      
      this.emit('process', job);
      this.jobs.delete(jobId);
      this.emit('completed', job);
    } catch (error) {
      _logger.error('Failed to process job in memory queue', { error, jobId });
      this.emit('failed', job, error);
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }
}
