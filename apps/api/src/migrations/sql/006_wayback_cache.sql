-- Create wayback_cache table for caching Wayback Machine API responses
CREATE TABLE IF NOT EXISTS wayback_cache (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    result JSONB NOT NULL,
    cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Add indexes
    CONSTRAINT wayback_cache_url_key UNIQUE (url)
);

-- Add index for faster lookups and cache expiration queries
CREATE INDEX IF NOT EXISTS idx_wayback_cache_cached_at ON wayback_cache(cached_at);

-- Add comment
COMMENT ON TABLE wayback_cache IS 'Caches responses from the Wayback Machine API to reduce API calls and improve performance'; 