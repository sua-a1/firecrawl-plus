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

export const scrapeQueueName = "scrapeQueue";
export const extractQueueName = "extractQueue";
export const loggingQueueName = "loggingQueue";
export const indexQueueName = "indexQueue";
export const generateLlmsTxtQueueName = "generateLlmsTxtQueue";
export const deepResearchQueueName = "deepResearchQueue";
export const summarizationQueueName = "summarizationQueue";

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
    // Use BullMQ for summarization
    summarizationQueue = new Queue(summarizationQueueName, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000,
        },
        removeOnFail: {
          age: 3600,
        },
      },
    });
    logger.info("BullMQ summarization queue created");
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
    _logger.info(`Created InMemoryQueue: ${name}`, {
      queueType: 'InMemory',
      listenerCount: this.listenerCount('process')
    });
  }

  // Add method to get queue size
  getQueueSize(): number {
    return this.jobs.size;
  }

  async add(name: string, data: any): Promise<{ id: string }> {
    const jobId = Math.random().toString(36).substring(7);
    const job = { id: jobId, name, data };
    this.jobs.set(jobId, job);
    
    _logger.info('Added job to in-memory queue', { 
      jobId, 
      name,
      queueName: this.name,
      queueSize: this.getQueueSize(),
      listenerCount: this.listenerCount('process'),
      jobData: {
        pageUrl: data.pageUrl,
        summaryType: data.summaryType,
        projectId: data.projectId,
        teamId: data.teamId,
        contentLength: data.originalText?.length
      }
    });
    
    this.emit('active', job);
    
    // Log if there are no process listeners
    if (this.listenerCount('process') === 0) {
      _logger.warn('No process listeners attached to queue', {
        queueName: this.name,
        queueSize: this.getQueueSize()
      });
    }
    
    setImmediate(() => this.processNext());
    return job;
  }

  private async processNext() {
    if (this.isProcessing || this.jobs.size === 0) {
      _logger.debug('Skipping processNext', {
        isProcessing: this.isProcessing,
        queueSize: this.jobs.size,
        queueName: this.name,
        hasProcessListeners: this.listenerCount('process') > 0
      });
      return;
    }
    
    this.isProcessing = true;
    const [jobId, job] = this.jobs.entries().next().value;
    
    try {
      _logger.info('Processing job from in-memory queue', { 
        jobId,
        queueName: this.name,
        queueSize: this.getQueueSize(),
        listenerCount: this.listenerCount('process'),
        jobData: {
          pageUrl: job.data.pageUrl,
          summaryType: job.data.summaryType,
          projectId: job.data.projectId,
          teamId: job.data.teamId,
          contentLength: job.data.originalText?.length
        }
      });
      
      // Get all listeners for the 'process' event
      const processListeners = this.listeners('process');
      
      // Only call the first process listener if any exist
      let result;
      if (processListeners.length > 0) {
        _logger.info('Calling process listener', {
          queueName: this.name,
          jobId,
          listenerCount: processListeners.length
        });
        result = await processListeners[0](job);
      } else {
        _logger.error('No process listeners found for queue', {
          queueName: this.name,
          jobId,
          queueSize: this.getQueueSize()
        });
      }
      
      this.jobs.delete(jobId);
      
      // Emit completion event with result
      this.emit('completed', job, result);
      _logger.info('Job completed successfully', { 
        jobId, 
        queueName: this.name,
        queueSize: this.getQueueSize(),
        success: result?.success,
        summaryId: result?.summary?.id
      });
    } catch (error) {
      _logger.error('Failed to process job in memory queue', { 
        error, 
        jobId,
        queueName: this.name,
        queueSize: this.getQueueSize(),
        jobData: {
          pageUrl: job.data.pageUrl,
          summaryType: job.data.summaryType,
          projectId: job.data.projectId
        }
      });
      this.emit('failed', job, error);
    } finally {
      this.isProcessing = false;
      if (this.jobs.size > 0) {
        // Process next job if any remain
        setImmediate(() => this.processNext());
      }
    }
  }
}
