-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "tsm_system_rows";

-- Create ENUMs
CREATE TYPE pricing_plan_interval AS ENUM ('day', 'week', 'month', 'year');
CREATE TYPE pricing_type AS ENUM ('one_time', 'recurring');
CREATE TYPE subscription_status AS ENUM (
    'trialing', 'active', 'canceled', 'incomplete', 
    'incomplete_expired', 'past_due', 'unpaid', 'paused'
);

-- Create tables in dependency order
-- Tables with no foreign keys first
CREATE TABLE pricing_plan (
    id SERIAL PRIMARY KEY,
    base_price NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE,
    gpt_35_turbo_price NUMERIC,
    gpt_4_price NUMERIC,
    max_messages_per_month INTEGER,
    name TEXT,
    price_per_message NUMERIC,
    stripe_subscription BOOLEAN NOT NULL
);

CREATE TABLE products (
    id TEXT PRIMARY KEY,
    active BOOLEAN,
    description TEXT,
    image TEXT,
    metadata JSONB,
    name TEXT
);

CREATE TABLE data_sources (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE,
    description TEXT,
    name TEXT,
    placeholder TEXT,
    type TEXT
);

CREATE TABLE constants (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE,
    default_prompt TEXT NOT NULL
);

CREATE TABLE marketing (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE,
    message TEXT
);

CREATE TABLE prompt (
    prompt_id SERIAL PRIMARY KEY,
    name TEXT,
    prompt TEXT
);

-- Tables with dependencies
CREATE TABLE company (
    company_id SERIAL PRIMARY KEY,
    company_name TEXT,
    display_name TEXT,
    is_white_label BOOLEAN,
    name TEXT NOT NULL,
    playground_type TEXT,
    pricing_plan_id INTEGER REFERENCES pricing_plan(id)
);

CREATE TABLE mendable_project (
    id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES company(company_id),
    created_at TIMESTAMP WITH TIME ZONE,
    display_id TEXT NOT NULL,
    enforce_whitelist BOOLEAN,
    isFaqPublic BOOLEAN NOT NULL,
    max_messages_per_month INTEGER,
    max_req_per_ip_per_minute INTEGER,
    name TEXT,
    prompt_id INTEGER,
    support_url TEXT,
    whitelisted_domains TEXT[]
);

CREATE TABLE prices (
    id TEXT PRIMARY KEY,
    active BOOLEAN,
    currency TEXT,
    description TEXT,
    interval pricing_plan_interval,
    interval_count INTEGER,
    metadata JSONB,
    product_id TEXT REFERENCES products(id),
    trial_period_days INTEGER,
    type pricing_type,
    unit_amount INTEGER
);

-- Users and related tables
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    avatar_url TEXT,
    billing_address JSONB,
    company_id INTEGER REFERENCES company(company_id),
    email TEXT,
    full_name TEXT,
    payment_method JSONB,
    FOREIGN KEY (id) REFERENCES users(id)
);

CREATE TABLE customers (
    id TEXT PRIMARY KEY REFERENCES users(id),
    stripe_customer_id TEXT,
    user_id TEXT REFERENCES users(id)
);

-- Conversation and Message tables
CREATE TABLE conversation (
    conversation_id SERIAL PRIMARY KEY,
    end_time TIMESTAMP WITH TIME ZONE,
    experiment_id TEXT,
    project_id INTEGER REFERENCES mendable_project(id) NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE message (
    message_id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversation(conversation_id) NOT NULL,
    embedding TEXT,
    is_taught BOOLEAN,
    message TEXT NOT NULL,
    model_configuration JSONB,
    prompt_text TEXT,
    rating_value INTEGER,
    rephrased_text TEXT,
    sender TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Remaining tables
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE,
    key TEXT,
    keyType TEXT NOT NULL,
    name TEXT,
    project_id INTEGER REFERENCES mendable_project(id)
);

CREATE TABLE data (
    id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES company(company_id),
    content TEXT,
    data_id TEXT REFERENCES data_sources(id),
    date_added TIMESTAMP WITH TIME ZONE,
    date_modified TIMESTAMP WITH TIME ZONE,
    embedding TEXT,
    manual_add BOOLEAN,
    message_id INTEGER REFERENCES message(message_id),
    project_id INTEGER REFERENCES mendable_project(id),
    search_index TSVECTOR,
    source TEXT,
    source_name TEXT,
    source_rank INTEGER,
    source_text TEXT
);

CREATE TABLE data_partitioned (
    id INTEGER NOT NULL,
    company_id INTEGER,
    company_name TEXT NOT NULL,
    content TEXT,
    data_id TEXT,
    date_added TIMESTAMP WITH TIME ZONE,
    date_modified TIMESTAMP WITH TIME ZONE,
    embedding TEXT,
    manual_add BOOLEAN,
    message_id INTEGER,
    project_id INTEGER,
    search_index TSVECTOR,
    source TEXT,
    source_name TEXT,
    source_rank INTEGER,
    source_text TEXT
);

CREATE TABLE model_configuration (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE,
    custom_prompt TEXT,
    model_name TEXT,
    project_id INTEGER REFERENCES mendable_project(id) NOT NULL,
    suggested_questions TEXT,
    support_link TEXT,
    temperature NUMERIC NOT NULL
);

CREATE TABLE monthly_message_counts (
    project_id INTEGER REFERENCES mendable_project(id) NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    message_count INTEGER,
    PRIMARY KEY (project_id, month, year)
);

CREATE TABLE source (
    id SERIAL PRIMARY KEY,
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    link TEXT,
    message_id INTEGER NOT NULL
);

CREATE TABLE suggested_questions (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE,
    project_id INTEGER REFERENCES mendable_project(id),
    question TEXT
);

CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    cancel_at TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN,
    canceled_at TIMESTAMP WITH TIME ZONE,
    company_id INTEGER REFERENCES company(company_id),
    created TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    price_id TEXT REFERENCES prices(id),
    quantity INTEGER,
    status subscription_status,
    sub_item_id TEXT,
    trial_end TIMESTAMP WITH TIME ZONE,
    trial_start TIMESTAMP WITH TIME ZONE,
    usage_pricing_id TEXT,
    user_id TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE user_notifications (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES company(company_id),
    notification_type TEXT NOT NULL,
    project_id INTEGER NOT NULL REFERENCES mendable_project(id),
    sent_date TIMESTAMP WITH TIME ZONE NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE z_testcomp_92511 (
    id SERIAL PRIMARY KEY,
    content TEXT,
    data_id TEXT REFERENCES data_sources(id),
    date_added TIMESTAMP WITH TIME ZONE,
    date_modified TIMESTAMP WITH TIME ZONE,
    embedding TEXT,
    manual_add BOOLEAN,
    message_id INTEGER REFERENCES message(message_id),
    project_id INTEGER REFERENCES mendable_project(id),
    search_index TSVECTOR,
    source TEXT,
    source_name TEXT,
    source_rank INTEGER,
    source_text TEXT
);

-- Create necessary indexes
CREATE INDEX IF NOT EXISTS idx_data_project_id ON data(project_id);
CREATE INDEX IF NOT EXISTS idx_data_company_id ON data(company_id);
CREATE INDEX IF NOT EXISTS idx_message_conversation_id ON message(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_project_id ON conversation(project_id);

-- Vector operations functions
CREATE OR REPLACE FUNCTION vector_avg(NUMERIC[])
RETURNS TEXT LANGUAGE SQL AS $$
    SELECT array_to_string(ARRAY(
        SELECT avg(val)::text
        FROM unnest($1) AS val
    ), ',');
$$;

CREATE OR REPLACE FUNCTION vector_dims(TEXT)
RETURNS INTEGER LANGUAGE SQL AS $$
    SELECT array_length(string_to_array($1, ','), 1);
$$;

CREATE OR REPLACE FUNCTION vector_norm(TEXT)
RETURNS NUMERIC LANGUAGE SQL AS $$
    SELECT sqrt(sum(val * val))
    FROM unnest(string_to_array($1, ',')::numeric[]) AS val;
$$;

-- Add other functions from supabase_types.ts
CREATE OR REPLACE FUNCTION combine_search_29(
    query_embedding TEXT,
    query_text TEXT,
    table_name TEXT,
    project_id INTEGER,
    similarity_threshold FLOAT,
    search_thres FLOAT,
    k INTEGER DEFAULT NULL
) RETURNS TABLE (
    id INTEGER,
    content TEXT,
    source TEXT,
    similarity FLOAT,
    rank INTEGER,
    similarity_rank INTEGER,
    rank_rank INTEGER,
    rrf_score FLOAT
) LANGUAGE plpgsql AS $$
DECLARE
    similarity_query TEXT;
    rank_query TEXT;
    final_query TEXT;
BEGIN
    -- Build similarity-based search query
    similarity_query := format(
        'SELECT id, content, source, 
        1 - (embedding <=> %L::vector) as similarity,
        NULL as rank
        FROM %I 
        WHERE project_id = %L 
        AND 1 - (embedding <=> %L::vector) > %L',
        query_embedding, table_name, project_id, query_embedding, similarity_threshold
    );

    -- Build rank-based search query
    rank_query := format(
        'SELECT id, content, source,
        NULL as similarity,
        ts_rank_cd(search_index, plainto_tsquery(%L)) as rank
        FROM %I 
        WHERE project_id = %L 
        AND search_index @@ plainto_tsquery(%L)
        AND ts_rank_cd(search_index, plainto_tsquery(%L)) > %L',
        query_text, table_name, project_id, query_text, query_text, search_thres
    );

    -- Combine queries with ranking logic
    final_query := format(
        'WITH combined_results AS (
            (%s)
            UNION ALL
            (%s)
        ),
        ranked_results AS (
            SELECT 
                id,
                content,
                source,
                similarity,
                rank,
                ROW_NUMBER() OVER (ORDER BY similarity DESC NULLS LAST) as similarity_rank,
                ROW_NUMBER() OVER (ORDER BY rank DESC NULLS LAST) as rank_rank,
                CASE 
                    WHEN similarity IS NOT NULL AND rank IS NOT NULL THEN
                        (1.0/similarity_rank + 1.0/rank_rank) / 2
                    WHEN similarity IS NOT NULL THEN
                        1.0/similarity_rank
                    ELSE
                        1.0/rank_rank
                END as rrf_score
            FROM combined_results
        )
        SELECT * FROM ranked_results
        ORDER BY rrf_score DESC
        LIMIT %L',
        similarity_query,
        rank_query,
        COALESCE(k, 10)
    );

    RETURN QUERY EXECUTE final_query;
END;
$$;

-- Add remaining functions from supabase_types.ts
CREATE OR REPLACE FUNCTION search_documents(
    k INTEGER,
    query_embedding TEXT,
    query_text TEXT,
    table_name TEXT,
    project_id INTEGER,
    limit_results INTEGER
) RETURNS TABLE (
    id INTEGER,
    content TEXT,
    source TEXT,
    similarity FLOAT,
    rank INTEGER,
    similarity_rank INTEGER,
    rank_rank INTEGER,
    rrf_score FLOAT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM combine_search_29(
        query_embedding,
        query_text,
        table_name,
        project_id,
        0.5, -- similarity_threshold
        0.1, -- search_thres
        LEAST(k, limit_results)
    );
END;
$$;

-- Add remaining functions from supabase_types.ts
CREATE OR REPLACE FUNCTION get_documents(
    c_company_id INTEGER,
    page_size INTEGER,
    z_offset INTEGER
) RETURNS TABLE (
    id INTEGER,
    content TEXT,
    source TEXT,
    data_id TEXT,
    date_added TIMESTAMP WITH TIME ZONE,
    date_modified TIMESTAMP WITH TIME ZONE,
    source_name TEXT,
    source_rank INTEGER
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d.content,
        d.source,
        d.data_id,
        d.date_added,
        d.date_modified,
        d.source_name,
        d.source_rank
    FROM data d
    WHERE d.company_id = c_company_id
    ORDER BY d.date_modified DESC NULLS LAST
    LIMIT page_size
    OFFSET z_offset;
END;
$$;

CREATE OR REPLACE FUNCTION get_index_types(
    _company_name TEXT,
    _project_id INTEGER
) RETURNS TSVECTOR LANGUAGE plpgsql AS $$
DECLARE
    table_name TEXT;
    result TSVECTOR;
BEGIN
    table_name := format('z_%s', lower(regexp_replace(_company_name, '[^a-zA-Z0-9]+', '_', 'g')));
    EXECUTE format('
        SELECT search_index 
        FROM %I 
        WHERE project_id = $1 
        LIMIT 1', table_name)
    INTO result
    USING _project_id;
    RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION get_project_and_company_with_model_configuration(
    p_project_id INTEGER
) RETURNS TABLE (
    project jsonb,
    company jsonb,
    model_configuration jsonb
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT 
        row_to_json(mp.*)::jsonb as project,
        row_to_json(c.*)::jsonb as company,
        row_to_json(mc.*)::jsonb as model_configuration
    FROM mendable_project mp
    JOIN company c ON mp.company_id = c.company_id
    LEFT JOIN model_configuration mc ON mp.id = mc.project_id
    WHERE mp.id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_project_company_model(
    api_key_in TEXT
) RETURNS TABLE (
    company jsonb,
    project jsonb,
    configuration jsonb
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT 
        row_to_json(c.*)::jsonb as company,
        row_to_json(mp.*)::jsonb as project,
        row_to_json(mc.*)::jsonb as configuration
    FROM api_keys ak
    JOIN mendable_project mp ON ak.project_id = mp.id
    JOIN company c ON mp.company_id = c.company_id
    LEFT JOIN model_configuration mc ON mp.id = mc.project_id
    WHERE ak.key = api_key_in;
END;
$$;

CREATE OR REPLACE FUNCTION get_project_message_count(
    p_project_id INTEGER,
    p_start_date TIMESTAMP WITH TIME ZONE,
    p_end_date TIMESTAMP WITH TIME ZONE
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    message_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO message_count
    FROM message m
    JOIN conversation c ON m.conversation_id = c.conversation_id
    WHERE 
        c.project_id = p_project_id
        AND m.timestamp BETWEEN p_start_date AND p_end_date;
    RETURN message_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_sources_count(
    company_name TEXT,
    project_id INTEGER
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    source_count INTEGER;
BEGIN
    SELECT COUNT(DISTINCT source)
    INTO source_count
    FROM data
    WHERE project_id = project_id;
    RETURN source_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_total_conversations_count_by_project(
    _project_id INTEGER
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    conversation_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO conversation_count
    FROM conversation
    WHERE project_id = _project_id;
    RETURN conversation_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_trained_messages_from_project_count(
    p_project_id INTEGER
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    trained_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO trained_count
    FROM message m
    JOIN conversation c ON m.conversation_id = c.conversation_id
    WHERE 
        c.project_id = p_project_id
        AND m.is_taught = true;
    RETURN trained_count;
END;
$$;

CREATE OR REPLACE FUNCTION getPricingPlanByName(
    company_name TEXT
) RETURNS SETOF pricing_plan LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT pp.*
    FROM pricing_plan pp
    JOIN company c ON c.pricing_plan_id = pp.id
    WHERE c.name = company_name;
END;
$$;

-- Add debug logging comments
COMMENT ON FUNCTION get_documents IS 'Retrieves documents for a company with pagination';
COMMENT ON FUNCTION get_index_types IS 'Gets search index types for a specific project';
COMMENT ON FUNCTION get_project_and_company_with_model_configuration IS 'Retrieves project, company, and model configuration details';
COMMENT ON FUNCTION get_project_company_model IS 'Gets project and company details by API key';
COMMENT ON FUNCTION get_project_message_count IS 'Counts messages in a date range for a project';
COMMENT ON FUNCTION get_sources_count IS 'Counts unique sources for a project';
COMMENT ON FUNCTION get_total_conversations_count_by_project IS 'Counts total conversations in a project';
COMMENT ON FUNCTION get_trained_messages_from_project_count IS 'Counts trained messages in a project';
COMMENT ON FUNCTION getPricingPlanByName IS 'Gets pricing plan details by company name'; 