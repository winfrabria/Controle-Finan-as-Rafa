-- WIN-17: private bucket for invoice originals.
-- Access is intentionally restricted to trusted server-side operations using
-- the Supabase service role; no anon/authenticated storage.objects policies
-- are created by this migration.
INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'notas-fiscais',
    'notas-fiscais',
    FALSE,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
