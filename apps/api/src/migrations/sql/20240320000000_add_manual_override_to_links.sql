-- Migration: Add manual_override column to links table
-- Description: Adds ability for users to manually override suggested alternative URLs

-- Up Migration
DO $$ BEGIN
    -- Check if the column doesn't exist before adding it
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'links'
        AND column_name = 'manual_override'
    ) THEN
        -- Add the manual_override column
        ALTER TABLE links 
        ADD COLUMN manual_override TEXT DEFAULT NULL;

        -- Add comment for documentation
        COMMENT ON COLUMN links.manual_override IS 'User-provided override URL for broken links. Takes precedence over suggested_alternative when set.';
    END IF;
END $$;

-- Down Migration
DO $$ BEGIN
    -- Check if the column exists before dropping it
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'links'
        AND column_name = 'manual_override'
    ) THEN
        -- Remove the manual_override column
        ALTER TABLE links 
        DROP COLUMN manual_override;
    END IF;
END $$; 