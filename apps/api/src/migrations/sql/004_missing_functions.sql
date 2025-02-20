-- Document retrieval functions
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

-- Index and type information functions
CREATE OR REPLACE FUNCTION get_index_types(
    _company_name TEXT,
    _project_id INTEGER
) RETURNS TSVECTOR LANGUAGE plpgsql AS $$
DECLARE
    table_name TEXT;
    result TSVECTOR;
BEGIN
    -- Get the company-specific table name
    table_name := format('z_%s', lower(regexp_replace(_company_name, '[^a-zA-Z0-9]+', '_', 'g')));
    
    -- Get the search index types for the specified project
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

-- Project and company information functions
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

-- Project statistics functions
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

-- Pricing plan functions
CREATE OR REPLACE FUNCTION getPricingPlanByName(
    company_name TEXT
) RETURNS pricing_plan LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT pp.*
    FROM pricing_plan pp
    JOIN company c ON c.pricing_plan_id = pp.id
    WHERE c.name = company_name;
END;
$$;

-- Text processing utility functions
CREATE OR REPLACE FUNCTION dmetaphone(text)
RETURNS text LANGUAGE sql AS $$
    SELECT array_to_string(ARRAY(
        SELECT regexp_replace(
            lower($1), 
            '[^a-z]', 
            '', 
            'g'
        )
    ), '');
$$;

CREATE OR REPLACE FUNCTION dmetaphone_alt(text)
RETURNS text LANGUAGE sql AS $$
    SELECT array_to_string(ARRAY(
        SELECT regexp_replace(
            lower($1), 
            '[^a-z0-9]', 
            '', 
            'g'
        )
    ), '');
$$;

-- Trigram utility functions
CREATE OR REPLACE FUNCTION gtrgm_compress(internal)
RETURNS internal LANGUAGE internal AS 'gtrgm_compress';

CREATE OR REPLACE FUNCTION gtrgm_decompress(internal)
RETURNS internal LANGUAGE internal AS 'gtrgm_decompress';

CREATE OR REPLACE FUNCTION gtrgm_in(cstring)
RETURNS gtrgm LANGUAGE internal AS 'gtrgm_in';

CREATE OR REPLACE FUNCTION gtrgm_out(gtrgm)
RETURNS cstring LANGUAGE internal AS 'gtrgm_out';

CREATE OR REPLACE FUNCTION gtrgm_options(internal)
RETURNS void LANGUAGE internal AS 'gtrgm_options';

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