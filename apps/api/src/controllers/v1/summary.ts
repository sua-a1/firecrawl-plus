import { Response } from 'express';
import { RequestWithAuth } from './types';
import { SummarizationService } from '../../services/summarization/summarization-service';
import { SummaryRepository } from '../../services/summarization/summary-repository';
import { logger } from '../../lib/logger';
import * as Sentry from '@sentry/node';
import { supabase_service } from '../../services/supabase';

// Types for the API endpoints
interface GetSummaryParams {
  page_url: string;
}

interface GetSummaryResponse {
  success: boolean;
  data?: {
    extractive_summary?: string;
    abstractive_summary?: string;
    original_text: string;
    metadata: Record<string, any>;
    created_at: string;
    updated_at: string;
  };
  error?: string;
}

interface GenerateSummaryRequest {
  url: string;
  text?: string;
  type: 'extractive' | 'abstractive' | 'both';
  maxLength?: number;
  minLength?: number;
  options?: {
    temperature?: number;
    modelName?: string;
    extractiveSummarizer?: 'transformers' | 'textrank' | 'lexrank';
  };
}

interface BulkSummaryRequest {
  urls: string[];
  type: 'extractive' | 'abstractive' | 'both';
  options?: GenerateSummaryRequest['options'];
}

// Initialize services
const summarizationService = new SummarizationService();
const summaryRepository = new SummaryRepository(supabase_service);

/**
 * Get summary for a specific URL
 */
export async function getSummaryController(
  req: RequestWithAuth<GetSummaryParams, undefined, undefined>,
  res: Response<GetSummaryResponse>
) {
  try {
    const { page_url } = req.params;
    const teamId = parseInt(req.auth.team_id, 10);

    logger.debug('Fetching summary', { page_url, teamId });

    const summary = await summaryRepository.getSummary(teamId, page_url);

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: 'Summary not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        extractive_summary: summary.extractive_summary || undefined,
        abstractive_summary: summary.abstractive_summary || undefined,
        original_text: summary.original_text,
        metadata: summary.metadata,
        created_at: summary.created_at,
        updated_at: summary.updated_at
      }
    });
  } catch (error) {
    Sentry.captureException(error);
    logger.error('Error fetching summary', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * Generate a new summary
 */
export async function generateSummaryController(
  req: RequestWithAuth<{}, GetSummaryResponse, GenerateSummaryRequest>,
  res: Response<GetSummaryResponse>
) {
  try {
    const { url, text, type, maxLength, minLength, options } = req.body;
    const teamId = parseInt(req.auth.team_id, 10);

    logger.debug('Generating summary', { url, type, teamId });

    // Generate summary
    const summary = await summarizationService.generateSummary(text || '', {
      type,
      maxLength,
      minLength,
      ...options
    });

    // Store in database
    const stored = await summaryRepository.storeSummary({
      project_id: teamId,
      page_url: url,
      original_text: text || '',
      extractive_summary: summary.extractive_summary || null,
      abstractive_summary: summary.abstractive_summary || null,
      summary_type: type,
      metadata: {
        options,
        url
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        extractive_summary: stored.extractive_summary || undefined,
        abstractive_summary: stored.abstractive_summary || undefined,
        original_text: stored.original_text,
        metadata: stored.metadata,
        created_at: stored.created_at,
        updated_at: stored.updated_at
      }
    });
  } catch (error) {
    Sentry.captureException(error);
    logger.error('Error generating summary', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * Get summaries in batch
 */
export async function getBatchSummariesController(
  req: RequestWithAuth<{}, { success: boolean; data?: any[]; error?: string }>,
  res: Response
) {
  try {
    const urlsParam = req.query.urls;
    const teamId = parseInt(req.auth.team_id, 10);

    // Parse URLs from query parameter
    let urls: string[];
    try {
      urls = Array.isArray(urlsParam) ? urlsParam.map(String) : JSON.parse(urlsParam as string);
      if (!Array.isArray(urls)) {
        throw new Error('Invalid URLs format');
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'URLs must be provided as a valid array in the query parameter'
      });
    }

    logger.debug('Fetching batch summaries', { urlCount: urls.length, teamId });

    // Get summaries one by one since we don't have a batch method
    const summaryPromises = urls.map(url => summaryRepository.getSummary(teamId, url));
    const summaries = await Promise.all(summaryPromises);

    return res.status(200).json({
      success: true,
      data: summaries.filter(Boolean) // Remove null values
    });
  } catch (error) {
    Sentry.captureException(error);
    logger.error('Error fetching batch summaries', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * Generate summaries in bulk
 */
export async function bulkGenerateSummariesController(
  req: RequestWithAuth<{}, { success: boolean; data?: any[]; error?: string }, BulkSummaryRequest>,
  res: Response
) {
  try {
    const { urls, type, options } = req.body;
    const teamId = parseInt(req.auth.team_id, 10);

    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({
        success: false,
        error: 'URLs must be provided as an array'
      });
    }

    logger.debug('Generating bulk summaries', { urlCount: urls.length, type, teamId });

    const summaryPromises = urls.map(async (url) => {
      try {
        const summary = await summarizationService.generateSummary('', {
          type,
          ...options
        });

        return summaryRepository.storeSummary({
          project_id: teamId,
          page_url: url,
          original_text: '',
          extractive_summary: summary.extractive_summary || null,
          abstractive_summary: summary.abstractive_summary || null,
          summary_type: type,
          metadata: {
            options,
            url
          }
        });
      } catch (error) {
        logger.error('Error generating summary for URL', { url, error });
        return {
          url,
          error: 'Failed to generate summary'
        };
      }
    });

    const results = await Promise.all(summaryPromises);

    return res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    Sentry.captureException(error);
    logger.error('Error generating bulk summaries', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
} 