# Feature 2: AI-Powered Content Summarization - Implementation Checklist

## Phase 1: Database & Infrastructure Setup

### Database Schema Implementation
- [x] Create SQL migration for new `page_summaries` table:
  ```sql
  -- Create enum type for summary types
  CREATE TYPE summary_type AS ENUM ('extractive', 'abstractive', 'both');

  -- Create the page_summaries table
  CREATE TABLE IF NOT EXISTS page_summaries (
    id SERIAL PRIMARY KEY,
    project_id INT NOT NULL REFERENCES mendable_project(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    original_text TEXT NOT NULL,
    extractive_summary TEXT,
    abstractive_summary TEXT,
    summary_type summary_type NOT NULL DEFAULT 'extractive',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT page_summaries_project_url_unique UNIQUE (project_id, page_url)
  );

  -- Create indexes for performance
  CREATE INDEX idx_page_summaries_project_id ON page_summaries(project_id);
  CREATE INDEX idx_page_summaries_page_url ON page_summaries(page_url);
  CREATE INDEX idx_page_summaries_created_at ON page_summaries(created_at);
  CREATE INDEX idx_page_summaries_summary_type ON page_summaries(summary_type);

  -- Add trigger for updated_at
  CREATE OR REPLACE FUNCTION update_page_summaries_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ language 'plpgsql';

  CREATE TRIGGER update_page_summaries_updated_at
    BEFORE UPDATE ON page_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_page_summaries_updated_at();

  ```

- [x] Update `supabase_types.ts` with new table types:
  ```typescript
  page_summaries: {
    Row: {
      id: number;
      project_id: number;
      page_url: string;
      original_text: string;
      extractive_summary: string | null;
      abstractive_summary: string | null;
      summary_type: 'extractive' | 'abstractive' | 'both';
      created_at: string;
      updated_at: string;
      metadata: Json;
    };
    Insert: {
      id?: number;
      project_id: number;
      page_url: string;
      original_text: string;
      extractive_summary?: string | null;
      abstractive_summary?: string | null;
      summary_type?: 'extractive' | 'abstractive' | 'both';
      created_at?: string;
      updated_at?: string;
      metadata?: Json;
    };
    Update: {
      id?: number;
      project_id?: number;
      page_url?: string;
      original_text?: string;
      extractive_summary?: string | null;
      abstractive_summary?: string | null;
      summary_type?: 'extractive' | 'abstractive' | 'both';
      created_at?: string;
      updated_at?: string;
      metadata?: Json;
    };
    Relationships: [
      {
        foreignKeyName: "page_summaries_project_id_fkey";
        columns: ["project_id"];
        referencedRelation: "mendable_project";
        referencedColumns: ["id"];
      }
    ];
  };

### Queue System Setup
- [x] Set up BullMQ for background processing:
  - [x] Configure Redis connection
  - [x] Set up queue workers
  - [x] Configure job priorities
- [x] Create queue configuration for summarization jobs:
  - [x] Define job types and schemas
  - [x] Set up retry policies
  - [x] Configure concurrency limits
- [x] Implement queue error handling and retry logic

## Phase 2: Core Summarization Service

### Content Extraction
- [x] Utilize existing Rust-based HTML transformer:
  - [x] Configure transformHtml options for summarization:
    - [x] Set `only_main_content: true` for focused extraction
    - [x] Define appropriate `include_tags` for content
    - [x] Set `exclude_tags` for noise removal (ads, nav, etc.)
  - [x] Add error handling and Cheerio fallback
  - [x] Implement content length validation
  - [x] Add logging for extraction process
- [x] Add support for different content types (HTML, Markdown)
- [x] Implement content cleaning post-extraction:
  - [x] Remove excessive whitespace
  - [x] Normalize text encoding
  - [x] Handle special characters

### Summarization Implementation
- [x] Set up Transformers.js as primary summarizer:
  - [x] Install and configure @xenova/transformers
  - [x] Set up model pipeline
  - [x] Configure model parameters
  - [x] Implement error handling
- [x] Implement node-summarizer as fallback summarizer:
  - [x] Set up configuration
  - [x] Implement TextRank algorithm
  - [x] Add LexRank as alternative
  - [x] Create fallback mechanism
- [x] Integrate OpenAI for abstractive summarization:
  - [x] Set up OpenAI client configuration
  - [x] Implement prompt engineering for better summaries
  - [x] Add token limit handling

### Integration with Existing Crawler
- [x] Add summarization configuration options:
  - [x] Add `enableSummarization` boolean flag to crawler options
  - [x] Update crawler types in `src/controllers/v1/types.ts`:
    ```typescript
    interface CrawlOptions {
      // ... existing options ...
      summarization?: {
        enabled: boolean;
        type?: 'extractive' | 'abstractive' | 'both';
        maxLength?: number;
      }
    }
    ```
  - [x] Update API request validation schema to reflect new options, parameters that have been added by the feature 1 and feature 2 implementations
  - [x] Add configuration validation
- [x] Modify crawler pipeline:
  - [x] Add conditional check for summarization flag
  - [x] Only trigger summarization if enabled
  - [x] Pass summarization options to the queue
  - [x] Add error handling for summarization failures
- [x] Update API documentation to reflect new options
- [x] Add configuration examples to README

## Phase 3: API Development

### New API Endpoints
- [x] Create endpoint for retrieving summaries:
  - [x] GET /v1/summaries/:page_url
  - [x] GET /v1/summaries/batch
- [x] Add endpoint for manual summarization requests:
  - [x] POST /v1/summaries/generate
- [x] Add bulk summarization request endpoint:
  - [x] POST /v1/summaries/bulk

### API Features
- [] Create API documentation:
  - [ ] Document all endpoints
  - [ ] Add usage examples
  - [ ] Include error responses


## Notes & Considerations
- Ensure backward compatibility with existing features
- Follow NestJS best practices
- Use TypeScript for type safety
- Implement proper error handling
- Add detailed logging
- Consider rate limiting and API quotas
- Plan for scalability
- Monitor OpenAI API costs
- Track Transformers.js vs Sumy performance metrics
- Implement graceful degradation strategy

