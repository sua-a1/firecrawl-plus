import "dotenv/config";
import { config } from "dotenv";
import { resolve } from "path";
import "../sentry";
import * as Sentry from "@sentry/node";
import { Job, Queue, Worker } from "bullmq";
import { logger as _logger } from "../../lib/logger";
import { redisConnection, getSummarizationQueue, summarizationQueueName } from "../queue-service";
import systemMonitor from "../system-monitor";
import { v4 as uuidv4 } from "uuid";
import { ContentExtractor } from "./content-extractor";
import { SummarizationService } from "./summarization.service";
import { SummaryRepository } from "./summary.repository";
import { createClient } from '@supabase/supabase-js';
import { Database } from '../../supabase_types';

// Type definitions
export type SummaryType = 'extractive' | 'abstractive' | 'both';

export interface ContentExtractionOptions {
  url: string;
  projectId?: number;
  teamId?: string;
}

// Load environment variables from .env file
config({ path: resolve(__dirname, '../../../.env') });

// Configuration constants
const workerLockDuration = Number(process.env.WORKER_LOCK_DURATION) || 60000;
const workerStalledCheckInterval = Number(process.env.WORKER_STALLED_CHECK_INTERVAL) || 30000;
const jobLockExtendInterval = Number(process.env.JOB_LOCK_EXTEND_INTERVAL) || 15000;
const jobLockExtensionTime = 5 * 60 * 1000; // 5 minutes
const cantAcceptConnectionInterval = 1000; // 1 second
const connectionMonitorInterval = Number(process.env.CONNECTION_MONITOR_INTERVAL) || 10;
const gotJobInterval = Number(process.env.CONNECTION_MONITOR_INTERVAL) || 20;

const runningJobs: Set<string> = new Set();
let isShuttingDown = false;

// Initialize Supabase client
_logger.info('Initializing Supabase client', {
  url: process.env.SUPABASE_URL,
  hasServiceToken: !!process.env.SUPABASE_SERVICE_TOKEN,
  serviceTokenLength: process.env.SUPABASE_SERVICE_TOKEN?.length
});

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_TOKEN!
);

// Test Supabase connection
(async () => {
  try {
    _logger.info('Testing Supabase connection...');
    const { data, error } = await supabase.from('page_summaries').select('count').single();
    if (error) {
      _logger.error('Failed to connect to Supabase', { 
        error,
        errorMessage: error.message,
        errorCode: error.code,
        details: error.details
      });
    } else {
      _logger.info('Successfully connected to Supabase');
    }
  } catch (error) {
    _logger.error('Error testing Supabase connection', { error });
  }
})();

// Initialize the summarization queue using BullMQ
const summarizationQueue = getSummarizationQueue();

// Create the worker
const worker = new Worker(
  summarizationQueueName,
  async (job: Job) => {
    const jobId = job.id || uuidv4(); // Ensure we always have a job ID
    _logger.info('Processing summarization job', { jobId });
    
    try {
      runningJobs.add(jobId);
      
      const { pageUrl, summaryType, projectId, teamId, originalText } = job.data;
      
      // Create content extractor
      const contentExtractor = new ContentExtractor();
      
      // Extract content if needed
      let textToSummarize = originalText;
      if (!textToSummarize) {
        const extractionOptions: ContentExtractionOptions = {
          url: pageUrl,
          projectId,
          teamId
        };
        textToSummarize = await contentExtractor.extract(extractionOptions);
      }
      
      // Generate summary
      const summarizationService = new SummarizationService();
      const summary = await summarizationService.generateSummary(textToSummarize, summaryType as SummaryType);
      
      // Store summary
      const summaryRepository = new SummaryRepository(supabase);
      const storedSummary = await summaryRepository.storeSummary({
        project_id: projectId,
        page_url: pageUrl,
        original_text: textToSummarize,
        extractive_summary: summary.extractive_summary,
        abstractive_summary: summary.abstractive_summary,
        summary_type: summaryType,
        metadata: {
          processedAt: new Date().toISOString(),
          jobId: jobId,
          teamId: teamId
        }
      });
      
      _logger.info('Successfully processed summarization job', { 
        jobId,
        summaryId: storedSummary.id
      });
      
      return { success: true, summary: storedSummary };
    } catch (error) {
      _logger.error('Failed to process summarization job', { 
        jobId,
        error 
      });
      throw error;
    } finally {
      runningJobs.delete(jobId);
    }
  },
  {
    connection: redisConnection,
    lockDuration: workerLockDuration,
    stalledInterval: workerStalledCheckInterval
  }
);

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  _logger.info('Received SIGTERM signal');
  isShuttingDown = true;
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  _logger.info('Received SIGINT signal');
  isShuttingDown = true;
  await worker.close();
  process.exit(0);
});

// Health check interval
setInterval(() => {
  _logger.info('Summarization worker health check', {
    runningJobs: Array.from(runningJobs),
    isShuttingDown
  });
}, 30000);

_logger.info('Starting summarization worker'); 