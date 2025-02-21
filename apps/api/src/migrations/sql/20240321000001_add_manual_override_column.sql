-- Migration: 20240321000001_add_manual_override_column.sql
-- Description: Adds manual_override column to links table

ALTER TABLE public.links
ADD COLUMN IF NOT EXISTS manual_override TEXT; 