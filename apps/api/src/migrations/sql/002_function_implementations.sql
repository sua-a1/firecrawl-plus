-- Vector operations functions
CREATE OR REPLACE FUNCTION vector_avg(NUMERIC[])
RETURNS TEXT LANGUAGE SQL AS $$
    SELECT array_to_string(ARRAY[
        SELECT avg(val)
        FROM unnest($1) AS val
    ], ',');
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

-- Search and matching functions
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

-- Project and company management functions
CREATE OR REPLACE FUNCTION create_mendable_project_3(
    _company_name TEXT,
    _pricing_plan_id INTEGER,
    _project_name TEXT
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    _company_id INTEGER;
    _project_id INTEGER;
    _display_id TEXT;
BEGIN
    -- Get company ID
    SELECT company_id INTO _company_id
    FROM company
    WHERE name = _company_name;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company not found: %', _company_name;
    END IF;

    -- Generate unique display ID
    _display_id := lower(regexp_replace(_project_name, '[^a-zA-Z0-9]+', '-', 'g'));

    -- Create project
    INSERT INTO mendable_project (
        company_id,
        created_at,
        display_id,
        name,
        isFaqPublic
    ) VALUES (
        _company_id,
        CURRENT_TIMESTAMP,
        _display_id,
        _project_name,
        false
    ) RETURNING id INTO _project_id;

    RETURN json_build_object(
        'project_id', _project_id,
        'display_id', _display_id
    )::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION create_company_table_2(company TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    table_name TEXT;
BEGIN
    table_name := format('z_%s', lower(regexp_replace(company, '[^a-zA-Z0-9]+', '_', 'g')));
    
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I (
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
        )', table_name
    );
END;
$$;

-- Index management functions
CREATE OR REPLACE FUNCTION create_indexs(tbl_name TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('
        CREATE INDEX IF NOT EXISTS idx_%I_project_id ON %I(project_id);
        CREATE INDEX IF NOT EXISTS idx_%I_company_id ON %I(company_id);
        CREATE INDEX IF NOT EXISTS idx_%I_search_index ON %I USING gin(search_index);
        CREATE INDEX IF NOT EXISTS idx_%I_embedding ON %I USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);
    ', 
    tbl_name, tbl_name,
    tbl_name, tbl_name,
    tbl_name, tbl_name,
    tbl_name, tbl_name
    );
END;
$$;

CREATE OR REPLACE FUNCTION update_search_index(table_name TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('
        UPDATE %I 
        SET search_index = to_tsvector(''english'', COALESCE(content, ''''))
        WHERE search_index IS NULL
    ', table_name);
END;
$$;

-- Message counting functions
CREATE OR REPLACE FUNCTION increment_message_count_2(
    p_projectid INTEGER,
    p_month INTEGER,
    p_year INTEGER
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO monthly_message_counts (project_id, month, year, message_count)
    VALUES (p_projectid, p_month, p_year, 1)
    ON CONFLICT (project_id, month, year)
    DO UPDATE SET message_count = monthly_message_counts.message_count + 1;
END;
$$;

CREATE OR REPLACE FUNCTION get_message_count_by_project(
    p_project_id INTEGER
) RETURNS TABLE (
    message_day TEXT,
    message_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT 
        to_char(timestamp, 'YYYY-MM-DD') as message_day,
        COUNT(*) as message_count
    FROM message m
    JOIN conversation c ON m.conversation_id = c.conversation_id
    WHERE c.project_id = p_project_id
    GROUP BY message_day
    ORDER BY message_day;
END;
$$;

-- Search functions
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

-- Utility functions for vector operations
CREATE OR REPLACE FUNCTION vector_send(TEXT)
RETURNS bytea LANGUAGE SQL AS $$
    SELECT E'\\x'::bytea || encode(string_to_array($1, ',')::numeric[]::float4[]::bytea, 'hex');
$$;

CREATE OR REPLACE FUNCTION vector_out(TEXT)
RETURNS cstring LANGUAGE SQL AS $$
    SELECT $1;
$$;

-- Add more functions as needed... 