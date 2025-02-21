-- Migration: Add page_summaries table
-- Description: Creates the page_summaries table for storing AI-generated content summaries

-- Up Migration
DO $$ BEGIN
    -- Create enum type for summary types if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'summary_type') THEN
        CREATE TYPE summary_type AS ENUM ('extractive', 'abstractive', 'both');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_page_summaries_project_id ON page_summaries(project_id);
CREATE INDEX IF NOT EXISTS idx_page_summaries_page_url ON page_summaries(page_url);
CREATE INDEX IF NOT EXISTS idx_page_summaries_created_at ON page_summaries(created_at);
CREATE INDEX IF NOT EXISTS idx_page_summaries_summary_type ON page_summaries(summary_type);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_page_summaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_page_summaries_updated_at ON page_summaries;
CREATE TRIGGER update_page_summaries_updated_at
    BEFORE UPDATE ON page_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_page_summaries_updated_at();

-- Disable RLS as we're handling auth at the application level
ALTER TABLE page_summaries DISABLE ROW LEVEL SECURITY;

-- Down Migration
DROP TRIGGER IF EXISTS update_page_summaries_updated_at ON page_summaries;
DROP FUNCTION IF EXISTS update_page_summaries_updated_at();
DROP TABLE IF EXISTS page_summaries;
DROP TYPE IF EXISTS summary_type; 