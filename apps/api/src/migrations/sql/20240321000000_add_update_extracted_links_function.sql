-- Migration: 20240321000000_add_update_extracted_links_function.sql
-- Description: Adds a stored procedure to update extracted_link with suggested_alternative

CREATE OR REPLACE FUNCTION public.update_extracted_links(link_ids INTEGER[])
RETURNS TABLE (
    id INTEGER,
    project_id INTEGER,
    page_url TEXT,
    extracted_link TEXT,
    status_code INTEGER,
    last_checked TIMESTAMP WITH TIME ZONE,
    suggested_alternative TEXT,
    manual_override TEXT,
    anchor_text TEXT,
    is_internal BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    affected_rows INTEGER;
    input_array_length INTEGER;
    r RECORD;
BEGIN
    -- Validate input
    IF link_ids IS NULL OR array_length(link_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Invalid input: link_ids array is null or empty';
    END IF;

    -- Get input array length
    SELECT array_length(link_ids, 1) INTO input_array_length;
    
    -- Log the input
    RAISE NOTICE 'Starting update_extracted_links with % links: %', input_array_length, link_ids;
    
    -- Start transaction
    BEGIN
        -- Log current state of links
        FOR r IN 
            SELECT id, extracted_link, suggested_alternative, status_code, project_id, manual_override
            FROM public.links
            WHERE id = ANY(link_ids)
        LOOP
            RAISE NOTICE 'Before update - Link ID: %, Project: %, Current URL: %, Suggestion: %, Override: %, Status: %',
                r.id, r.project_id, r.extracted_link, r.suggested_alternative, r.manual_override, r.status_code;
        END LOOP;

        -- Create temporary table for updated rows
        CREATE TEMP TABLE updated_links ON COMMIT DROP AS
        SELECT * FROM public.links WHERE FALSE;

        -- Perform update and capture results
        WITH updated AS (
            UPDATE public.links
            SET 
                extracted_link = COALESCE(manual_override, suggested_alternative),
                status_code = NULL,
                last_checked = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ANY(link_ids)
                AND (manual_override IS NOT NULL OR suggested_alternative IS NOT NULL)
                AND COALESCE(manual_override, suggested_alternative) != extracted_link
                AND status_code IN (404, 500, 502, 503, 504)  -- Only update broken links
            RETURNING *
        )
        INSERT INTO updated_links
        SELECT * FROM updated;

        -- Get number of affected rows
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        
        -- Log the results
        RAISE NOTICE 'Update completed: % rows were updated out of % input links', 
            affected_rows, input_array_length;
            
        -- Log final state of updated links
        FOR r IN 
            SELECT id, extracted_link, suggested_alternative, manual_override, status_code, project_id
            FROM updated_links
        LOOP
            RAISE NOTICE 'After update - Link ID: %, Project: %, New URL: %, Original Suggestion: %, Override: %, New Status: %',
                r.id, r.project_id, r.extracted_link, r.suggested_alternative, r.manual_override, r.status_code;
        END LOOP;

        -- Return the updated rows
        RETURN QUERY SELECT * FROM updated_links;

        -- Transaction will automatically commit here
        -- Temp table will be dropped due to ON COMMIT DROP
    EXCEPTION WHEN OTHERS THEN
        -- Log the error details
        RAISE NOTICE 'Error in update_extracted_links: %, SQLSTATE: %', SQLERRM, SQLSTATE;
        RAISE EXCEPTION 'Failed to update links: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    END;
END;
$$ LANGUAGE plpgsql; 