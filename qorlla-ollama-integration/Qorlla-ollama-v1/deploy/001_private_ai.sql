-- Apply as a dedicated migration using the application's migration runner.
CREATE TABLE IF NOT EXISTS ai_private_daily_usage (
  tenant_id TEXT NOT NULL,
  usage_day DATE NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  PRIMARY KEY (tenant_id,usage_day)
);
-- Grant only SELECT, INSERT and UPDATE to the private AI gateway DB role.
-- Revoke table access from PUBLIC and non-gateway roles in deployment provisioning.
