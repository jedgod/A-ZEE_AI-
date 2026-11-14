-- Run with migration-owner privileges after reviewing existing AZTrade schema.
-- This migration does not enable execution, create broker credentials or grant public privileges.
BEGIN;
CREATE SCHEMA IF NOT EXISTS aztrade;
CREATE TABLE IF NOT EXISTS aztrade.source_licenses (
 source_id text PRIMARY KEY CHECK (length(source_id) BETWEEN 2 AND 80),
 provider_name text NOT NULL,
 asset_classes text[] NOT NULL,
 allowed_uses text[] NOT NULL DEFAULT '{}',
 approved boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT false,
 expires_at timestamptz,
 contract_reference text NOT NULL,
 approved_by text,
 approved_at timestamptz,
 CHECK (allowed_uses <@ ARRAY['display','historical','paper']::text[])
);
CREATE TABLE IF NOT EXISTS aztrade.daily_usage (
 user_id text NOT NULL,
 scope text NOT NULL,
 utc_day date NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK (used>=0),
 PRIMARY KEY(user_id,scope,utc_day)
);
CREATE TABLE IF NOT EXISTS aztrade.daily_requests (
 user_id text NOT NULL,
 scope text NOT NULL,
 request_id uuid NOT NULL,
 utc_day date NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','complete','refunded')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,scope,request_id)
);
CREATE TABLE IF NOT EXISTS aztrade.broker_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 user_id text NOT NULL,
 provider_id text NOT NULL,
 external_subject_hash text NOT NULL,
 secret_reference text NOT NULL, -- reference to secret manager only; NEVER OAuth tokens
 status text NOT NULL CHECK(status IN('active','revoked','expired','error')),
 scopes text[] NOT NULL CHECK(scopes <@ ARRAY['accounts:read','positions:read','balances:read']::text[]),
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 UNIQUE(tenant_id,user_id,provider_id,external_subject_hash)
);
ALTER TABLE aztrade.broker_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE aztrade.broker_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aztrade_broker_subject ON aztrade.broker_connections;
CREATE POLICY aztrade_broker_subject ON aztrade.broker_connections
 USING (tenant_id = nullif(current_setting('aztrade.tenant_id',true),'') AND user_id = nullif(current_setting('aztrade.user_id',true),''))
 WITH CHECK (tenant_id = nullif(current_setting('aztrade.tenant_id',true),'') AND user_id = nullif(current_setting('aztrade.user_id',true),''));
-- Serialize quota operations by locking a unique counter row. Same request_id never double counts.
CREATE OR REPLACE FUNCTION aztrade.reserve_daily_quota(p_user text,p_scope text,p_id uuid,p_limit integer)
RETURNS TABLE(admitted boolean,replay boolean,used integer) LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_day date := (now() AT TIME ZONE 'UTC')::date;
 v_state text; v_used integer;
BEGIN
 IF p_limit < 0 OR p_limit > 100000 OR length(p_user)=0 OR length(p_scope)=0 THEN RAISE EXCEPTION 'INVALID_QUOTA'; END IF;
 INSERT INTO aztrade.daily_usage(user_id,scope,utc_day) VALUES(p_user,p_scope,v_day) ON CONFLICT DO NOTHING;
 SELECT u.used INTO v_used FROM aztrade.daily_usage u WHERE u.user_id=p_user AND u.scope=p_scope AND u.utc_day=v_day FOR UPDATE;
 SELECT r.status INTO v_state FROM aztrade.daily_requests r WHERE r.user_id=p_user AND r.scope=p_scope AND r.request_id=p_id;
 IF FOUND THEN
   RETURN QUERY SELECT (v_state IN ('reserved','complete')),true,v_used; RETURN;
 END IF;
 IF v_used >= p_limit THEN RETURN QUERY SELECT false,false,v_used; RETURN; END IF;
 INSERT INTO aztrade.daily_requests(user_id,scope,request_id,utc_day) VALUES(p_user,p_scope,p_id,v_day);
 UPDATE aztrade.daily_usage u SET used=u.used+1 WHERE u.user_id=p_user AND u.scope=p_scope AND u.utc_day=v_day;
 RETURN QUERY SELECT true,false,v_used+1;
END $$;
CREATE OR REPLACE FUNCTION aztrade.finalize_daily_quota(p_user text,p_scope text,p_id uuid,p_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_status text;v_day date;
BEGIN
 SELECT status,utc_day INTO v_status,v_day FROM aztrade.daily_requests
 WHERE user_id=p_user AND scope=p_scope AND request_id=p_id FOR UPDATE;
 IF NOT FOUND OR v_status<>'reserved' THEN RETURN; END IF;
 IF p_success THEN
  UPDATE aztrade.daily_requests SET status='complete' WHERE user_id=p_user AND scope=p_scope AND request_id=p_id;
 ELSE
  UPDATE aztrade.daily_usage SET used=GREATEST(0,used-1) WHERE user_id=p_user AND scope=p_scope AND utc_day=v_day;
  UPDATE aztrade.daily_requests SET status='refunded' WHERE user_id=p_user AND scope=p_scope AND request_id=p_id;
 END IF;
END $$;
-- These functions require tightly scoped grants to the backend role by the deployment owner.
-- The app role must not own tables, bypass RLS, or be allowed to change source licenses.
COMMIT;
