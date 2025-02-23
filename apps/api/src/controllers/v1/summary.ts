import { Response } from 'express';
import { RequestWithAuth } from './types';
import { logger } from '../../lib/logger';
import { SummarizationService } from '../../services/summarization/summarization-service';
import { SummaryRepository } from '../../services/summarization/summary-repository';
import * as Sentry from '@sentry/node';
import { supabase_service } from '../../services/supabase';
import { ContentExtractor, ContentExtractionOptions } from '../../services/summarization/content-extractor';
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import { scrapeDocument } from '../../lib/extract/document-scraper';
import { PlanType } from '../../types';
import { ScrapeOptions } from './types';
import { load } from 'cheerio';

// Create logger instance for this module
const moduleLogger = logger.child({ module: 'SummaryController' });

// Initialize services
const summarizationService = new SummarizationService();
const summaryRepository = new SummaryRepository(supabase_service);
const contentExtractor = new ContentExtractor();

// Constants for content fetching
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const FETCH_TIMEOUT = 30000; // 30 seconds

/**
 * Sleep utility function
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    metadata: any;
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
  maxLength?: number;
  minLength?: number;
  options?: GenerateSummaryRequest['options'];
}

// Add rate limiter for parallel requests
const rateLimiter = {
  maxConcurrent: 5,
  queue: [] as (() => void)[],
  running: 0,
  
  async acquire() {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.running++;
  },
  
  release() {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
};

// Add type for stored summary results
interface SummaryResult {
  url?: string;
  error?: string;
  project_id?: number;
  page_url?: string;
  original_text?: string;
  extractive_summary?: string | null;
  abstractive_summary?: string | null;
  summary_type?: string;
  metadata?: any;
  created_at?: string;
  updated_at?: string;
}

/**
 * Fetch and extract content from a URL with retries
 */
async function fetchAndExtractContent(url: string): Promise<string> {
  moduleLogger.debug('Fetching content from URL', { url });
  
  const maxRetries = 2; // Reduced retries
  const retryDelay = 1000; // 1 second
  const timeouts = [15000, 20000]; // Even shorter timeouts
  
  // Reuse proxy agent across requests
  const proxyAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    timeout: Math.max(...timeouts),
    scheduling: 'lifo',
    maxSockets: 10,
    maxFreeSockets: 5
  });

  // Wait for rate limiter
  await rateLimiter.acquire();
  
  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const axiosInstance = axios.create({
          timeout: timeouts[attempt],
          maxRedirects: 3,
          decompress: true,
          validateStatus: (status) => status < 400,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html',
            'Accept-Language': 'en-US',
            'Accept-Encoding': 'gzip',
            'Cache-Control': 'no-cache'
          },
          httpsAgent: proxyAgent,
          responseType: 'text',
          transitional: {
            forcedJSONParsing: false,
            silentJSONParsing: false
          }
        });

        if (attempt > 0) {
          moduleLogger.debug('Retry attempt', { url, attempt: attempt + 1 });
        }

        const response = await axiosInstance.get(url);

        // Quick validation of content
        if (!response.data || response.data.length < 100) {
          throw new Error('Invalid or too short content received');
        }

        moduleLogger.debug('Fetched URL', { 
          url,
          contentLength: response.data.length,
          contentType: response.headers['content-type']
        });

        // Optimized Cheerio usage
        const $ = load(response.data, {
          xml: false,
          decodeEntities: true
        });

        // Remove all unwanted elements at once
        $('script, style, noscript, iframe, header, footer, nav, aside, .header, .footer, .sidebar, .nav, .menu, .social, .share, .ad, .cookie-banner, .popup, .modal, form, button, .comments, meta, link, [style*="display: none"]').remove();

        // Efficient content extraction
        let content = '';
        
        // First try specific content areas
        const mainContent = $('article, [role="main"], main, .content, .post, .article, .entry-content, .post-content, #content, #main').first();
        
        if (mainContent.length) {
          content = mainContent.text();
        } else {
          // Find the div with the most text content
          let maxLength = 0;
          $('div').each((_, el) => {
            const text = $(el).text().trim();
            if (text.length > maxLength && text.length > 200) { // Minimum content threshold
              maxLength = text.length;
              content = text;
            }
          });
        }

        // Quick content cleanup
        content = content
          .replace(/[\r\n\t]+/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();

        if (!content || content.length < 100) {
          throw new Error('Insufficient content extracted');
        }

        moduleLogger.debug('Content extracted', {
          url,
          contentLength: content.length
        });

        return content;

      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1;
        const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
        
        if (isLastAttempt) throw error;
        
        moduleLogger.warn('Extraction attempt failed', {
          url,
          attempt: attempt + 1,
          isTimeout,
          error: error.message
        });

        await sleep(retryDelay);
      }
    }

    throw new Error('All extraction attempts failed');
  } finally {
    rateLimiter.release();
  }
}

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

    moduleLogger.debug('Fetching summary', { page_url, teamId });

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
    moduleLogger.error('Error fetching summary', { error });
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

    moduleLogger.debug('Generating summary', { url, type, teamId });

    // If text is not provided, fetch and extract from URL
    let contentToSummarize = text;
    if (!contentToSummarize) {
      contentToSummarize = await fetchAndExtractContent(url);
    }

    // Generate summary
    const summary = await summarizationService.generateSummary(contentToSummarize, {
      type,
      maxLength,
      minLength,
      ...options
    });

    // Store in database
    const stored = await summaryRepository.storeSummary({
      project_id: teamId,
      page_url: url,
      original_text: contentToSummarize,
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
    moduleLogger.error('Error generating summary', { error });
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

    moduleLogger.debug('Fetching batch summaries', { urlCount: urls.length, teamId });

    // Get summaries one by one since we don't have a batch method
    const summaryPromises = urls.map(url => summaryRepository.getSummary(teamId, url));
    const summaries = await Promise.all(summaryPromises);

    return res.status(200).json({
      success: true,
      data: summaries.filter(Boolean) // Remove null values
    });
  } catch (error) {
    Sentry.captureException(error);
    moduleLogger.error('Error fetching batch summaries', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * Generate summaries in bulk with optimized parallel processing
 */
export async function bulkGenerateSummariesController(
  req: RequestWithAuth<{}, { success: boolean; data?: any[]; error?: string }, BulkSummaryRequest>,
  res: Response
) {
  try {
    const { urls, type, maxLength, minLength, options } = req.body;
    const teamId = parseInt(req.auth.team_id, 10);

    if (!urls?.length) {
      return res.status(400).json({
        success: false,
        error: 'URLs must be provided as a non-empty array'
      });
    }

    moduleLogger.debug('Starting bulk summary generation', { 
      urlCount: urls.length, 
      type,
      teamId 
    });

    // Process in batches of 5 for better control
    const batchSize = 5;
    const results: SummaryResult[] = [];
    
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (url) => {
        try {
          const contentToSummarize = await fetchAndExtractContent(url);
          
          const summary = await summarizationService.generateSummary(contentToSummarize, {
            type,
            maxLength,
            minLength,
            ...options
          });

          return summaryRepository.storeSummary({
            project_id: teamId,
            page_url: url,
            original_text: contentToSummarize,
            extractive_summary: summary.extractive_summary || null,
            abstractive_summary: summary.abstractive_summary || null,
            summary_type: type,
            metadata: { options, url }
          });
        } catch (error) {
          moduleLogger.error('Summary generation failed', { url, error });
          return { url, error: 'Failed to generate summary' } as SummaryResult;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      moduleLogger.debug('Batch processed', {
        batchSize: batch.length,
        completedCount: results.length,
        totalCount: urls.length
      });
    }

    return res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    Sentry.captureException(error);
    moduleLogger.error('Bulk summary generation failed', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
} 