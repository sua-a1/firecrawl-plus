-- Create url_embeddings table for storing OpenAI embeddings
CREATE TABLE IF NOT EXISTS url_embeddings (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    embedding vector(1536) NOT NULL, -- Using pgvector for efficient vector operations
    model TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Add indexes
    CONSTRAINT url_embeddings_url_key UNIQUE (url)
);

-- Add index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_url_embeddings_embedding ON url_embeddings USING ivfflat (embedding vector_cosine_ops);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_url_embeddings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_url_embeddings_updated_at
    BEFORE UPDATE ON url_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_url_embeddings_updated_at();

-- Add comment
COMMENT ON TABLE url_embeddings IS 'Stores OpenAI embeddings for URLs to enable semantic similarity search'; 