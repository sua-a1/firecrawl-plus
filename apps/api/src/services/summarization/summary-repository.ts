import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../supabase_types';
import { logger } from '../../lib/logger';

export interface StoredSummary {
  id: number;
  project_id: number;
  page_url: string;
  original_text: string;
  extractive_summary: string | null;
  abstractive_summary: string | null;
  summary_type: 'extractive' | 'abstractive' | 'both';
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
}

export class SummaryRepository {
  private readonly logger = logger.child({ module: 'SummaryRepository' });

  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * Store a new summary in the database
   */
  async storeSummary(summary: Omit<StoredSummary, 'id' | 'created_at' | 'updated_at'>): Promise<StoredSummary> {
    this.logger.debug('Storing summary', { pageUrl: summary.page_url });

    const { data, error } = await this.supabase
      .from('page_summaries')
      .upsert([summary], {
        onConflict: 'project_id,page_url',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Error storing summary', { error, summary });
      throw error;
    }

    return data as StoredSummary;
  }

  /**
   * Get a summary by project ID and page URL
   */
  async getSummary(projectId: number, pageUrl: string): Promise<StoredSummary | null> {
    this.logger.debug('Getting summary', { projectId, pageUrl });

    const { data, error } = await this.supabase
      .from('page_summaries')
      .select()
      .eq('project_id', projectId)
      .eq('page_url', pageUrl)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Record not found
        return null;
      }
      this.logger.error('Error getting summary', { error, projectId, pageUrl });
      throw error;
    }

    return data as StoredSummary;
  }

  /**
   * Update an existing summary
   */
  async updateSummary(
    projectId: number, 
    pageUrl: string, 
    updates: Partial<Omit<StoredSummary, 'id' | 'project_id' | 'page_url' | 'created_at' | 'updated_at'>>
  ): Promise<StoredSummary> {
    this.logger.debug('Updating summary', { projectId, pageUrl, updates });

    const { data, error } = await this.supabase
      .from('page_summaries')
      .update(updates)
      .eq('project_id', projectId)
      .eq('page_url', pageUrl)
      .select()
      .single();

    if (error) {
      this.logger.error('Error updating summary', { error, projectId, pageUrl, updates });
      throw error;
    }

    return data as StoredSummary;
  }

  /**
   * Delete a summary
   */
  async deleteSummary(projectId: number, pageUrl: string): Promise<void> {
    this.logger.debug('Deleting summary', { projectId, pageUrl });

    const { error } = await this.supabase
      .from('page_summaries')
      .delete()
      .eq('project_id', projectId)
      .eq('page_url', pageUrl);

    if (error) {
      this.logger.error('Error deleting summary', { error, projectId, pageUrl });
      throw error;
    }
  }

  /**
   * Get all summaries for a project with pagination
   */
  async getProjectSummaries(
    projectId: number, 
    page: number = 1, 
    pageSize: number = 50
  ): Promise<{ summaries: StoredSummary[]; total: number }> {
    this.logger.debug('Getting project summaries', { projectId, page, pageSize });

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      this.supabase
        .from('page_summaries')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .range(from, to),
      this.supabase
        .from('page_summaries')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
    ]);

    if (error || countError) {
      this.logger.error('Error getting project summaries', { error, countError, projectId });
      throw error || countError;
    }

    return {
      summaries: data as StoredSummary[],
      total: count || 0
    };
  }
} 