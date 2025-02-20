-- Trigram-based search functions
CREATE OR REPLACE FUNCTION keyword_search_trigram22(
    k INTEGER,
    query_text TEXT,
    table_name TEXT,
    project_id INTEGER,
    limit_results INTEGER
) RETURNS TABLE (
    id INTEGER,
    content TEXT,
    source TEXT,
    similarity_score FLOAT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            id,
            content,
            source,
            similarity(content, $1) as similarity_score
        FROM %I
        WHERE 
            project_id = $2 
            AND similarity(content, $1) > 0.1
        ORDER BY similarity_score DESC
        LIMIT $3
    ', table_name)
    USING query_text, project_id, LEAST(k, limit_results);
END;
$$;

-- Content priority search functions
CREATE OR REPLACE FUNCTION search_content_priority30(
    query_text TEXT,
    tbl_name TEXT,
    num_results INTEGER,
    search_thres FLOAT
) RETURNS TABLE (
    id INTEGER,
    content TEXT,
    source TEXT,
    rank INTEGER
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            id,
            content,
            source,
            ts_rank_cd(search_index, plainto_tsquery($1)) * COALESCE(source_rank, 1) as rank
        FROM %I
        WHERE search_index @@ plainto_tsquery($1)
        AND ts_rank_cd(search_index, plainto_tsquery($1)) > $2
        ORDER BY rank DESC
        LIMIT $3
    ', tbl_name)
    USING query_text, search_thres, num_results;
END;
$$;

CREATE OR REPLACE FUNCTION search_content_priority_by_project_2(
    tbl_name TEXT,
    query_text TEXT,
    search_thres FLOAT,
    num_results INTEGER,
    project_id INTEGER
) RETURNS TABLE (
    id INTEGER,
    content TEXT,
    source TEXT,
    rank FLOAT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            id,
            content,
            source,
            ts_rank_cd(search_index, plainto_tsquery($1)) * COALESCE(source_rank, 1) as rank
        FROM %I
        WHERE 
            project_id = $2
            AND search_index @@ plainto_tsquery($1)
            AND ts_rank_cd(search_index, plainto_tsquery($1)) > $3
        ORDER BY rank DESC
        LIMIT $4
    ', tbl_name)
    USING query_text, project_id, search_thres, num_results;
END;
$$;

-- Project and company management functions
CREATE OR REPLACE FUNCTION create_new_company_table_5(
    _company_name TEXT,
    _company_display_name TEXT
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    _company_id INTEGER;
BEGIN
    INSERT INTO company (
        name,
        company_name,
        display_name,
        is_white_label,
        pricing_plan_id
    ) VALUES (
        _company_name,
        _company_display_name,
        _company_display_name,
        false,
        1  -- Default pricing plan
    ) RETURNING company_id INTO _company_id;

    RETURN _company_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_new_project_2(
    _company_id INTEGER,
    _project_name TEXT
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    _project_id INTEGER;
    _display_id TEXT;
BEGIN
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

-- Message and conversation functions
CREATE OR REPLACE FUNCTION get_messages_by_project_and_rating(
    _project_id INTEGER,
    _rating_value INTEGER,
    current_page INTEGER,
    pages_per_set INTEGER
) RETURNS TABLE (
    message_id INTEGER,
    conversation_id INTEGER,
    message TEXT,
    message_timestamp TIMESTAMP WITH TIME ZONE,
    sender TEXT,
    rating_value INTEGER,
    prev_message_id INTEGER,
    prev_message TEXT,
    prev_message_timestamp TIMESTAMP WITH TIME ZONE,
    prev_sender TEXT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    WITH rated_messages AS (
        SELECT 
            m.message_id,
            m.conversation_id,
            m.message,
            m.message_timestamp,
            m.sender,
            m.rating_value,
            LAG(m.message_id) OVER (PARTITION BY m.conversation_id ORDER BY m.message_timestamp) as prev_message_id,
            LAG(m.message) OVER (PARTITION BY m.conversation_id ORDER BY m.message_timestamp) as prev_message,
            LAG(m.message_timestamp) OVER (PARTITION BY m.conversation_id ORDER BY m.message_timestamp) as prev_message_timestamp,
            LAG(m.sender) OVER (PARTITION BY m.conversation_id ORDER BY m.message_timestamp) as prev_sender
        FROM message m
        JOIN conversation c ON m.conversation_id = c.conversation_id
        WHERE 
            c.project_id = _project_id
            AND m.rating_value = _rating_value
    )
    SELECT *
    FROM rated_messages
    ORDER BY message_timestamp DESC
    LIMIT pages_per_set
    OFFSET (current_page - 1) * pages_per_set;
END;
$$;

CREATE OR REPLACE FUNCTION get_messages_without_sources_by_project_with_prev(
    _project_id INTEGER,
    current_page INTEGER,
    pages_per_set INTEGER
) RETURNS TABLE (
    message_id INTEGER,
    conversation_id INTEGER,
    message TEXT,
    message_timestamp TIMESTAMP WITH TIME ZONE,
    sender TEXT,
    rating_value INTEGER,
    prev_message_id INTEGER,
    prev_message TEXT,
    prev_message_timestamp TIMESTAMP WITH TIME ZONE,
    prev_sender TEXT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    WITH messages_without_sources AS (
        SELECT 
            m.message_id,
            m.conversation_id,
            m.message,
            m.message_timestamp,
            m.sender,
            m.rating_value,
            LAG(m.message_id) OVER (PARTITION BY m.conversation_id ORDER BY m.message_timestamp) as prev_message_id,
            LAG(m.message) OVER (PARTITION BY m.conversation_id ORDER BY m.message_timestamp) as prev_message,
            LAG(m.message_timestamp) OVER (PARTITION BY m.conversation_id ORDER BY m.message_timestamp) as prev_message_timestamp,
            LAG(m.sender) OVER (PARTITION BY m.conversation_id ORDER BY m.message_timestamp) as prev_sender
        FROM message m
        JOIN conversation c ON m.conversation_id = c.conversation_id
        LEFT JOIN source s ON m.message_id = s.message_id
        WHERE 
            c.project_id = _project_id
            AND s.id IS NULL
    )
    SELECT *
    FROM messages_without_sources
    ORDER BY message_timestamp DESC
    LIMIT pages_per_set
    OFFSET (current_page - 1) * pages_per_set;
END;
$$;

-- Source management functions
CREATE OR REPLACE FUNCTION get_sources_info_new(
    company_name TEXT,
    project_id INTEGER,
    pages_per_set INTEGER,
    current_page INTEGER
) RETURNS TABLE (
    source TEXT,
    source_rank INTEGER,
    data_id TEXT,
    source_text TEXT,
    source_name TEXT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT DISTINCT
            source,
            source_rank,
            data_id,
            source_text,
            source_name
        FROM %I
        WHERE project_id = $1
        ORDER BY source_rank DESC NULLS LAST, source
        LIMIT $2
        OFFSET ($3 - 1) * $2
    ', 'data')  -- or the appropriate table name pattern for the company
    USING project_id, pages_per_set, current_page;
END;
$$;

CREATE OR REPLACE FUNCTION get_sources_from_message(
    mid INTEGER
) RETURNS TABLE (
    id INTEGER,
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    link TEXT,
    message_id INTEGER
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.content, s.created_at, s.link, s.message_id
    FROM source s
    WHERE s.message_id = mid;
END;
$$;

-- Subscription and billing functions
CREATE OR REPLACE FUNCTION get_subscription(
    p_project_id INTEGER
) RETURNS TABLE (
    id TEXT,
    cancel_at TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN,
    canceled_at TIMESTAMP WITH TIME ZONE,
    company_id INTEGER,
    created TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    current_period_start TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    price_id TEXT,
    quantity INTEGER,
    status subscription_status,
    sub_item_id TEXT,
    trial_end TIMESTAMP WITH TIME ZONE,
    trial_start TIMESTAMP WITH TIME ZONE,
    usage_pricing_id TEXT,
    user_id TEXT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT s.*
    FROM subscriptions s
    JOIN mendable_project mp ON s.company_id = mp.company_id
    WHERE mp.id = p_project_id
    ORDER BY s.created DESC
    LIMIT 1;
END;
$$;

-- Statistics and counting functions
CREATE OR REPLACE FUNCTION get_trained_messages_from_project(
    p_project_id INTEGER,
    current_page INTEGER,
    pages_per_set INTEGER
) RETURNS TABLE (
    current_message jsonb,
    preceding_message jsonb
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    WITH message_pairs AS (
        SELECT 
            m.message_id,
            m.conversation_id,
            m.message,
            m.timestamp,
            m.sender,
            m.rating_value,
            LAG(m.message_id) OVER (PARTITION BY m.conversation_id ORDER BY m.timestamp) as prev_message_id,
            LAG(m.message) OVER (PARTITION BY m.conversation_id ORDER BY m.timestamp) as prev_message,
            LAG(m.timestamp) OVER (PARTITION BY m.conversation_id ORDER BY m.timestamp) as prev_timestamp,
            LAG(m.sender) OVER (PARTITION BY m.conversation_id ORDER BY m.timestamp) as prev_sender
        FROM message m
        JOIN conversation c ON m.conversation_id = c.conversation_id
        WHERE 
            c.project_id = p_project_id
            AND m.is_taught = true
    )
    SELECT 
        json_build_object(
            'message_id', message_id,
            'conversation_id', conversation_id,
            'message', message,
            'timestamp', timestamp,
            'sender', sender,
            'rating_value', rating_value
        )::jsonb as current_message,
        json_build_object(
            'message_id', prev_message_id,
            'message', prev_message,
            'timestamp', prev_timestamp,
            'sender', prev_sender
        )::jsonb as preceding_message
    FROM message_pairs
    WHERE prev_message_id IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT pages_per_set
    OFFSET (current_page - 1) * pages_per_set;
END;
$$;

-- Add more functions if needed... 