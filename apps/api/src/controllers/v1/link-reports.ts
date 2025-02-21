import { Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../supabase_types';
import { LinkManagementService } from '../../services/link-management/link-management.service';
import { logger } from '../../lib/logger';
import { RequestWithAuth } from './types';
import { z } from 'zod';

// Report query parameters schema
const reportQuerySchema = z.object({
  sort_by: z.enum(['last_checked', 'status_code', 'page_url', 'extracted_link']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  page: z.string().transform(Number).optional(),
  per_page: z.string().transform(Number).optional(),
  format: z.enum(['json', 'csv']).optional()
});

type ReportQueryParams = z.infer<typeof reportQuerySchema>;

// Batch fix request schema
const batchFixRequestSchema = z.object({
  project_id: z.union([z.string(), z.number()])
});

// Manual override request schema
const manualOverrideRequestSchema = z.object({
  manual_override_url: z.string().url(),
  project_id: z.union([z.string(), z.number()])
});

type BatchFixRequest = z.infer<typeof batchFixRequestSchema>;
type ManualOverrideRequest = z.infer<typeof manualOverrideRequestSchema>;

interface BrokenLinkReport {
  broken_links: {
    id: number;
    source_page: string;
    broken_url: string;
    status_code: number;
    suggested_alternative: string | null;
    manual_override: string | null;
    anchor_text: string | null;
    last_checked: string;
  }[];
  total_count: number;
  project_id: string;
  metadata: {
    filters_applied: {
      excludes_test_data: boolean;
      excludes_fixed_links: boolean;
      status_codes: number[];
    };
    last_updated: string;
    pagination?: {
      current_page: number;
      total_pages: number;
      per_page: number;
      total_count: number;
    };
  };
}

interface BatchFixResponse {
  processed: number;
  total: number;
  success: boolean;
  completed: boolean;
  skipped_duplicates?: number;
  duplicate_details?: {
    link_id: number;
    existing_link_id: number;
    page_url: string;
    current_url: string;
    suggested_url: string;
  }[];
}

interface SingleFixResponse {
  status: 'validating' | 'updating' | 'completed' | 'error';
  progress: number;
  success: boolean;
  link?: any;
  error?: string;
}

interface ProcessedLink {
  link_id: number;
  error?: string;
}

function isBatchFixRequest(body: any): body is BatchFixRequest {
  return typeof body === 'object' && body !== null && 
    (typeof body.project_id === 'string' || typeof body.project_id === 'number');
}

function isManualOverrideRequest(body: any): body is ManualOverrideRequest {
  return typeof body === 'object' && body !== null && 
    typeof body.manual_override_url === 'string' && 
    (typeof body.project_id === 'string' || typeof body.project_id === 'number');
}

export class LinkReportsController {
  constructor(
    private readonly supabaseService: SupabaseClient<Database>
  ) {}

  private getLinkManagementService(projectId: number) {
    return new LinkManagementService(
      this.supabaseService,
      { projectId }
    );
  }

  async getBrokenLinksReport(
    req: RequestWithAuth<{ project_id: string }, {}, ReportQueryParams>,
    res: Response
  ): Promise<void> {
    try {
      const projectId = req.params.project_id;
      const query = reportQuerySchema.parse(req.query);
      
      logger.info('Fetching broken links report', { 
        projectId,
        sortBy: query.sort_by,
        sortOrder: query.sort_order,
        page: query.page,
        perPage: query.per_page,
        format: query.format
      });

      // Build query with sorting and pagination
      let dbQuery = this.supabaseService
        .from('links')
        .select('*', { count: 'exact' })
        .eq('project_id', projectId)
        .in('status_code', [404, 500, 502, 503, 504])
        // Filter out test URLs
        .not('page_url', 'like', '%test-page-%')
        .not('extracted_link', 'like', '%broken-link-%')
        // Ensure we're not showing duplicates
        .neq('extracted_link', 'suggested_alternative')
        // Only show links that haven't been fixed
        .is('manual_override', 'null');

      // Apply sorting if specified
      if (query.sort_by) {
        dbQuery = dbQuery.order(query.sort_by, {
          ascending: query.sort_order === 'asc'
        });
      } else {
        // Default sorting: Show newest broken links first
        dbQuery = dbQuery.order('last_checked', { ascending: false });
      }

      // Apply pagination
      const page = query.page || 1;
      const perPage = query.per_page || 50;
      const start = (page - 1) * perPage;

      // First get the total count without range to validate pagination
      const { count: totalCount, error: countError } = await this.supabaseService
        .from('links')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .in('status_code', [404, 500, 502, 503, 504])
        .not('page_url', 'like', '%test-page-%')
        .not('extracted_link', 'like', '%broken-link-%')
        .neq('extracted_link', 'suggested_alternative')
        .is('manual_override', 'null');

      if (countError) {
        logger.error('Failed to get total count', {
          error: countError,
          projectId,
          page,
          perPage
        });
        throw countError;
      }

      const count = totalCount || 0;
      // If requested page is beyond available data, return last available page
      const totalPages = Math.ceil(count / perPage);
      const adjustedPage = Math.min(page, Math.max(1, totalPages));
      const adjustedStart = (adjustedPage - 1) * perPage;

      // Add range only if we have data
      if (count > 0) {
        dbQuery = dbQuery.range(adjustedStart, adjustedStart + perPage - 1);
      }

      // Execute query
      const { data: links, error } = await dbQuery;
      
      if (error) {
        logger.error('Database query failed', {
          error,
          projectId,
          queryFilters: {
            project_id: projectId,
            status_codes: [404, 500, 502, 503, 504],
            excludes_test_data: true,
            excludes_fixed_links: true,
            pagination: {
              requestedPage: page,
              adjustedPage,
              perPage,
              totalCount: count,
              totalPages
            }
          }
        });
        throw error;
      }

      const report: BrokenLinkReport = {
        broken_links: (links || []).map(link => ({
          id: link.id,
          source_page: link.page_url,
          broken_url: link.extracted_link,
          status_code: link.status_code || 0,
          suggested_alternative: link.suggested_alternative,
          manual_override: link.manual_override,
          anchor_text: link.anchor_text,
          last_checked: link.last_checked
        })),
        total_count: count,
        project_id: projectId,
        metadata: {
          filters_applied: {
            excludes_test_data: true,
            excludes_fixed_links: true,
            status_codes: [404, 500, 502, 503, 504]
          },
          last_updated: new Date().toISOString(),
          pagination: {
            current_page: adjustedPage,
            total_pages: totalPages,
            per_page: perPage,
            total_count: count
          }
        }
      };

      logger.info('Generated broken links report', {
        projectId,
        totalLinks: report.total_count,
        returnedLinks: report.broken_links.length,
        page,
        perPage,
        format: query.format,
        hasTestData: report.broken_links.some(l => l.source_page.includes('test-page-')),
        hasSuggestions: report.broken_links.filter(l => l.suggested_alternative !== null).length
      });

      // Handle different formats
      if (query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="broken-links-${projectId}-${new Date().toISOString()}.csv"`);
        // Send CSV header
        res.write('Source Page,Broken URL,Status Code,Suggested Alternative,Anchor Text,Last Checked\n');
        // Send data rows
        report.broken_links.forEach(link => {
          res.write(`${link.source_page},${link.broken_url},${link.status_code},${link.suggested_alternative || ''},${link.anchor_text || ''},${link.last_checked}\n`);
        });
        res.end();
      } else {
        // Default JSON response
        res.json(report);
      }
    } catch (error) {
      logger.error('Failed to generate broken links report', {
        error,
        projectId: req.params.project_id,
        errorType: error.constructor.name,
        errorCode: error.code,
        errorMessage: error.message,
        errorDetails: error.details,
        errorHint: error.hint,
        stack: error.stack,
        query: req.query,
        timestamp: new Date().toISOString()
      });

      // Handle specific error types
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Invalid query parameters',
          details: error.errors
        });
        return;
      }

      // Handle Supabase errors
      if (error.code) {
        res.status(500).json({
          error: 'Database query failed',
          details: {
            code: error.code,
            message: error.message,
            hint: error.hint
          }
        });
        return;
      }

      // Generic error response
      res.status(500).json({
        error: 'Failed to generate broken links report',
        details: error.message
      });
    }
  }

  async acceptAllSuggestions(
    req: RequestWithAuth<unknown, BatchFixRequest>,
    res: Response
  ): Promise<void> {
    try {
      const body = batchFixRequestSchema.parse(req.body);
      const projectId = body.project_id;

      logger.info('Processing suggested alternatives', {
        projectId
      });

      // Get all broken links with suggestions that haven't been manually overridden
      const { data: links, error: fetchError } = await this.supabaseService
        .from('links')
        .select('*')
        .eq('project_id', projectId)
        .is('manual_override', null)
        .not('suggested_alternative', 'is', null)
        .in('status_code', [404, 500, 502, 503, 504])
        // Filter out test URLs, matching broken links report
        .not('page_url', 'like', '%test-page-%')
        .not('extracted_link', 'like', '%broken-link-%')
        // Ensure we're not showing duplicates
        .neq('extracted_link', 'suggested_alternative');

      if (fetchError) {
        logger.error('Failed to fetch links with suggestions', {
          error: fetchError,
          projectId
        });
        throw fetchError;
      }

      if (!links?.length) {
        logger.info('No links found with suggestions', { projectId });
        res.json({
          processed: 0,
          total: 0,
          success: true,
          completed: true
        });
        return;
      }

      // Process the links
      const processed: number[] = [];
      const skipped: ProcessedLink[] = [];

      for (const link of links) {
        try {
          // Update manual_override instead of extracted_link
          const { error: updateError } = await this.supabaseService
            .from('links')
            .update({
              manual_override: link.suggested_alternative,
              updated_at: new Date().toISOString()
            })
            .eq('id', link.id)
            .eq('project_id', projectId);

          if (updateError) {
            logger.error('Failed to update link', {
              error: updateError,
              linkId: link.id,
              projectId
            });
            skipped.push({
              link_id: link.id,
              error: updateError.message
            });
          } else {
            processed.push(link.id);
            logger.info('Successfully applied suggestion', {
              linkId: link.id,
              originalUrl: link.extracted_link,
              newUrl: link.suggested_alternative
            });
          }
        } catch (error: any) {
          logger.error('Error processing link', {
            error,
            linkId: link.id,
            projectId
          });
          skipped.push({
            link_id: link.id,
            error: error.message
          });
        }
      }

      logger.info('Completed processing suggestions', {
        projectId,
        processedCount: processed.length,
        skippedCount: skipped.length,
        totalLinks: links.length
      });

      res.json({
        processed: processed.length,
        skipped: skipped.length,
        total: links.length,
        success: true,
        completed: true,
        details: {
          processed,
          skipped
        }
      });
      return;
    } catch (error: any) {
      logger.error('Error processing suggestions', {
        error,
        projectId: (req.body as BatchFixRequest | undefined)?.project_id
      });
      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }
  }

  async acceptSingleSuggestion(
    req: RequestWithAuth<{ link_id: string }>,
    res: Response
  ): Promise<void> {
    try {
      const linkId = req.params.link_id;
      
      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      logger.info('Starting single fix for link', { linkId });
      
      // Send initial status
      res.write(`data: ${JSON.stringify({
        status: 'validating',
        progress: 0,
        success: true
      } as SingleFixResponse)}\n\n`);

      // Validate link exists and has suggestion
      const { data: link, error: fetchError } = await this.supabaseService
        .from('links')
        .select('*')
        .eq('id', linkId)
        .single();

      if (fetchError || !link?.suggested_alternative) {
        throw new Error('Link not found or no suggestion available');
      }

      // Send validation complete status
      res.write(`data: ${JSON.stringify({
        status: 'updating',
        progress: 50,
        success: true
      } as SingleFixResponse)}\n\n`);

      // Update the link
      const { data: updatedLink, error: updateError } = await this.supabaseService
        .from('links')
        .update({ 
          extracted_link: link.suggested_alternative,
          manual_override: null,
          status_code: null,
          last_checked: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', linkId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Send completion status
      res.write(`data: ${JSON.stringify({
        status: 'completed',
        progress: 100,
        success: true,
        link: updatedLink
      } as SingleFixResponse)}\n\n`);
      
      res.end();
    } catch (error) {
      logger.error('Failed to accept suggestion', {
        error,
        linkId: req.params.link_id
      });
      
      // Send error status
      res.write(`data: ${JSON.stringify({
        status: 'error',
        progress: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to accept suggestion'
      } as SingleFixResponse)}\n\n`);
      
      res.end();
    }
  }

  async manualOverride(
    req: RequestWithAuth<{ link_id: string }, ManualOverrideRequest>,
    res: Response
  ): Promise<void> {
    try {
      const linkId = req.params.link_id;
      const body = manualOverrideRequestSchema.parse(req.body);
      const { manual_override_url } = body;

      logger.info('Starting manual override for link', { 
        linkId,
        manual_override_url
      });

      // Get the link
      const { data: link, error: linkError } = await this.supabaseService
        .from('links')
        .select('*')
        .eq('id', linkId)
        .single();

      if (linkError) {
        logger.error('Failed to fetch link for override', {
          error: linkError,
          linkId
        });
        throw linkError;
      }

      // Update the link
      const { error: updateError } = await this.supabaseService
        .from('links')
        .update({
          manual_override: manual_override_url,
          updated_at: new Date().toISOString()
        })
        .eq('id', linkId);

      if (updateError) {
        logger.error('Failed to update link with override', {
          error: updateError,
          linkId,
          manual_override_url
        });
        throw updateError;
      }

      logger.info('Successfully applied manual override', {
        linkId,
        originalUrl: link.extracted_link,
        newUrl: manual_override_url
      });

      res.json({
        success: true,
        link_id: linkId,
        original_url: link.extracted_link,
        manual_override_url
      });
    } catch (error: any) {
      logger.error('Error in manual override', {
        error,
        linkId: req.params.link_id,
        requestBody: req.body
      });
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
} 