CREATE TABLE IF NOT EXISTS platform_api_keys (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY(tenant_id, user_id)
    REFERENCES admin_memberships(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_api_limits (
  key_id UUID NOT NULL REFERENCES platform_api_keys(id),
  bucket BIGINT NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY(key_id, bucket)
);
