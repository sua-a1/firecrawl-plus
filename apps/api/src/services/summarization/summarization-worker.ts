import "dotenv/config";
import "../sentry";
import * as Sentry from "@sentry/node";
import { Job, Queue, Worker } from "bullmq";
import { logger as _logger } from "../../lib/logger";
import { redisConnection, getSummarizationQueue } from "../queue-service";
import systemMonitor from "../system-monitor";
import { v4 as uuidv4 } from "uuid";
import { ContentExtractor, ContentExtractionOptions } from "./content-extractor";
import { SummarizationService, SummaryType } from "./summarization-service";
import { SummaryRepository } from "./summary-repository";
import { createClient } from '@supabase/supabase-js';
import { Database } from '../../supabase_types';
import { InMemoryQueue } from "../queue-service";

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
const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Initialize repositories
const summaryRepository = new SummaryRepository(supabase);

// Handle graceful shutdown
process.on("SIGINT", () => {
  _logger.info("Received SIGINT signal");
  isShuttingDown = true;
});

process.on("SIGTERM", () => {
  _logger.info("Received SIGTERM signal");
  isShuttingDown = true;
});

const processSummarizationJobInternal = async (token: string, job: Job) => {
  if (!job.id) {
    throw new Error("Job has no ID");
  }

  const logger = _logger.child({
    module: "summarization-worker",
    method: "processSummarizationJobInternal",
    jobId: job.id,
    teamId: job.data?.teamId ?? undefined,
  });

  const extendLockInterval = setInterval(async () => {
    logger.info(`🔄 Worker extending lock on job ${job.id}`);
    await job.extendLock(token, jobLockExtensionTime);
  }, jobLockExtendInterval);

  try {
    // Extract content first
    const contentExtractor = new ContentExtractor(logger);
    const contentType = job.data.contentType || 'html';
    
    logger.info('Starting content extraction', {
      contentType,
      url: job.data.pageUrl,
      textLength: job.data.originalText.length
    });

    const extractedContent = await contentExtractor.extractContent(
      job.data.originalText,
      job.data.pageUrl,
      {
        removeBoilerplate: true,
        includeImages: false,
        maxLength: job.data.maxLength,
        customIncludeTags: job.data.includeTags,
        customExcludeTags: job.data.excludeTags,
        contentType,
        convertToMarkdown: contentType === 'html',
        normalizeWhitespace: true,
        removeEmptyLines: true
      }
    );

    logger.info('Content extraction completed', {
      extractedLength: extractedContent.length
    });

    // Generate summary using the appropriate service
    const summarizationService = new SummarizationService();
    
    logger.info('Starting summary generation', {
      summaryType: job.data.summaryType,
      maxLength: job.data.maxLength
    });

    const summary = await summarizationService.generateSummary(extractedContent, {
      type: job.data.summaryType as SummaryType,
      maxLength: job.data.maxLength || 150,
      minLength: 50,
      temperature: 0.3
    });

    logger.info('Summary generation completed', {
      hasExtractive: !!summary.extractive_summary,
      hasAbstractive: !!summary.abstractive_summary
    });

    // Store the summary in the database
    const storedSummary = await summaryRepository.storeSummary({
      project_id: job.data.projectId,
      page_url: job.data.pageUrl,
      original_text: job.data.originalText,
      extractive_summary: summary.extractive_summary || null,
      abstractive_summary: summary.abstractive_summary || null,
      summary_type: job.data.summaryType,
      metadata: {
        contentType,
        processedAt: new Date().toISOString(),
        jobId: job.id,
        teamId: job.data.teamId,
        plan: job.data.plan
      }
    });

    logger.info('Summary stored in database', {
      summaryId: storedSummary.id,
      pageUrl: storedSummary.page_url
    });

    return {
      success: true,
      summary: storedSummary
    };

  } catch (error) {
    logger.error('Error processing summarization job', { error });
    throw error;
  } finally {
    clearInterval(extendLockInterval);
  }
};

export const processSummarizationJob = async (token: string, job: Job) => {
  return await Sentry.startSpan(
    {
      name: "Process summarization job",
      op: "queue.process",
      attributes: {
        "messaging.message.id": job.id,
        "messaging.operation": "process",
        "messaging.message.body.size": job.data?.sentry?.size,
      },
    },
    async (span) => {
      return await processSummarizationJobInternal(token, job);
    }
  );
};

const workerFun = async (queue: Queue | InMemoryQueue) => {
  const logger = _logger.child({ module: "summarization-worker", method: "workerFun" });
  logger.info('Initializing summarization worker', { queueType: queue instanceof Queue ? 'BullMQ' : 'InMemory' });

  if (queue instanceof Queue) {
    // BullMQ queue handling
    const worker = new Worker(queue.name, async (job) => {
      const token = uuidv4();
      logger.debug('Processing BullMQ job', { jobId: job.id, token });
      return await processSummarizationJob(token, job);
    }, {
      connection: redisConnection,
      lockDuration: workerLockDuration,
      stalledInterval: workerStalledCheckInterval,
      maxStalledCount: 10,
    });

    worker.on('completed', (job) => {
      logger.info('BullMQ job completed successfully', { jobId: job.id });
      if (job.id) {
        runningJobs.delete(job.id);
      }
    });

    worker.on('failed', (job, error) => {
      logger.error('BullMQ job failed', { jobId: job?.id, error });
      if (job?.id) {
        runningJobs.delete(job.id);
      }
    });

    worker.on('error', (error) => {
      logger.error('BullMQ worker error', { error });
    });

    process.on('SIGTERM', async () => {
      await worker.close();
    });

    process.on('SIGINT', async () => {
      await worker.close();
    });
  } else {
    // In-memory queue handling
    queue.on('process', async (job) => {
      try {
        const token = uuidv4();
        logger.debug('Processing in-memory job', { jobId: job.id, token });
        await processSummarizationJob(token, job);
        logger.info('In-memory job completed successfully', { jobId: job.id });
      } catch (error) {
        logger.error('Error processing in-memory job', { error, jobId: job.id });
        throw error;
      }
    });

    queue.on('error', (error) => {
      logger.error('In-memory queue error', { error });
    });
  }
};

// Start the worker
(async () => {
  await workerFun(getSummarizationQueue());
})(); 