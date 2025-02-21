-- Migration: 005_link_management_tables.sql
-- Description: Creates tables for link management feature including links, link_redirects, and source_links

-- Up Migration
DO $$ BEGIN

-- Create links table
CREATE TABLE IF NOT EXISTS public.links (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES mendable_project(id),
    page_url TEXT NOT NULL,
    extracted_link TEXT NOT NULL,
    status_code INTEGER,
    last_checked TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    suggested_alternative TEXT,
    anchor_text TEXT,
    is_internal BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, page_url, extracted_link)
);
ALTER TABLE public.links DISABLE ROW LEVEL SECURITY;

-- Add indexes for links table
CREATE INDEX IF NOT EXISTS idx_links_page_url ON public.links(page_url);
CREATE INDEX IF NOT EXISTS idx_links_extracted_link ON public.links(extracted_link);
CREATE INDEX IF NOT EXISTS idx_links_status_code ON public.links(status_code);
CREATE INDEX IF NOT EXISTS idx_links_project_id ON public.links(project_id);

-- Create link_redirects table
CREATE TABLE IF NOT EXISTS public.link_redirects (
    id SERIAL PRIMARY KEY,
    link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL,
    redirected_url TEXT NOT NULL,
    status_code INTEGER,
    redirect_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(link_id, original_url, redirected_url)
);
ALTER TABLE public.link_redirects DISABLE ROW LEVEL SECURITY;

-- Add indexes for link_redirects table
CREATE INDEX IF NOT EXISTS idx_link_redirects_link_id ON public.link_redirects(link_id);

-- Create source_links table
CREATE TABLE IF NOT EXISTS public.source_links (
    id SERIAL PRIMARY KEY,
    source_id INTEGER REFERENCES source(id) ON DELETE CASCADE,
    link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
    data_id TEXT REFERENCES data_sources(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_id, link_id)
);
ALTER TABLE public.source_links DISABLE ROW LEVEL SECURITY;

-- Add indexes for source_links table
CREATE INDEX IF NOT EXISTS idx_source_links_source_id ON public.source_links(source_id);
CREATE INDEX IF NOT EXISTS idx_source_links_link_id ON public.source_links(link_id);
CREATE INDEX IF NOT EXISTS idx_source_links_data_id ON public.source_links(data_id);

END $$; 