-- Anonymous hourly counters survive account/scan deletion, preventing quota-reset abuse.
CREATE TABLE IF NOT EXISTS image_provider_usage (
  bucket TIMESTAMPTZ PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 200)
);
