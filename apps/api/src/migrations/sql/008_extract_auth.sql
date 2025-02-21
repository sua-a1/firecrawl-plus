-- Add auth_credit_usage_chunk_extract RPC function
CREATE OR REPLACE FUNCTION auth_credit_usage_chunk_extract(input_key TEXT)
RETURNS TABLE (
    team_id TEXT,
    price_id TEXT,
    remaining_credits INTEGER,
    is_extract BOOLEAN
) LANGUAGE plpgsql AS $$
BEGIN
    -- Return a hardcoded successful response
    -- This completely bypasses any authentication or credit checks
    RETURN QUERY
    SELECT 
        '1'::TEXT as team_id,
        'price_1234' as price_id,
        1000000 as remaining_credits,
        TRUE as is_extract;
END;
$$;

-- Add debug logging comment
COMMENT ON FUNCTION auth_credit_usage_chunk_extract IS 'RPC function that bypasses all authentication and credit checks for extract mode'; 