CREATE TABLE IF NOT EXISTS az_entitlements (
 user_id text PRIMARY KEY,
 tier text NOT NULL CHECK (tier IN ('free','plus','premium')) DEFAULT 'free',
 status text NOT NULL CHECK (status IN ('active','grace','expired','revoked')) DEFAULT 'active',
 period_end timestamptz,
 version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS az_usage (
 user_id text NOT NULL,
 period date NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
 PRIMARY KEY(user_id, period)
);
CREATE TABLE IF NOT EXISTS az_requests (
 user_id text NOT NULL,
 request_id uuid NOT NULL,
 payload_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','completed','failed')),
 response jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id, request_id)
);
CREATE TABLE IF NOT EXISTS az_preferences (
 user_id text PRIMARY KEY,
 writing_style text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS az_billing_events (
 event_id text PRIMARY KEY,
 processed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON az_entitlements FROM PUBLIC;
REVOKE ALL ON az_usage FROM PUBLIC;
REVOKE ALL ON az_requests FROM PUBLIC;
REVOKE ALL ON az_preferences FROM PUBLIC;
REVOKE ALL ON az_billing_events FROM PUBLIC;
