import { v4 as uuidv4 } from "uuid";
import { logger } from "../../lib/logger";
import { getSummarizationQueue } from "../queue-service";
import * as Sentry from "@sentry/node";

export interface SummarizationJobData {
  teamId: string;
  plan: string;
  pageUrl: string;
  originalText: string;
  summaryType: 'extractive' | 'abstractive' | 'both';
  maxLength?: number;
  subId?: string;
  projectId: number;
}

export interface SummarizationJobOptions {
  priority?: number;
  jobId?: string;
}

export async function addSummarizationJob(
  data: SummarizationJobData,
  options: SummarizationJobOptions = {},
) {
  const jobId = options.jobId || uuidv4();
  const priority = options.priority || 10;

  logger.debug("Adding summarization job to queue", {
    jobId,
    teamId: data.teamId,
    pageUrl: data.pageUrl,
    summaryType: data.summaryType,
  });

  const size = JSON.stringify(data).length;
  return await Sentry.startSpan(
    {
      name: "Add summarization job",
      op: "queue.publish",
      attributes: {
        "messaging.message.id": jobId,
        "messaging.destination.name": getSummarizationQueue().name,
        "messaging.message.body.size": size,
      },
    },
    async (span) => {
      await getSummarizationQueue().add(
        jobId,
        {
          ...data,
          sentry: {
            trace: Sentry.spanToTraceHeader(span),
            baggage: Sentry.spanToBaggageHeader(span),
            size,
          },
        },
        {
          priority,
          jobId,
        },
      );
    },
  );
} 