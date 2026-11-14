-- 038: which engine made a video job. "simulated" is a preview with a sample clip (no provider key, or
-- private mode); "fal" is a real Fal.ai request, whose queue URLs are kept in provider_ref so the job can be polled.
ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'simulated' CHECK (provider IN ('simulated', 'fal'));
ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS provider_ref TEXT CHECK (provider_ref IS NULL OR char_length(provider_ref) <= 1000);
