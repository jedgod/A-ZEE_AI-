-- Run as trusted migration owner. The application role must NOT own the users table.
-- Review grants before applying to an existing installation.
BEGIN;
CREATE OR REPLACE FUNCTION public.aztrade_provision_identity(p_subject text, p_tenant text, p_tier text)
RETURNS TABLE(id uuid, azee_user_id text, tenant_id text, tier text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
 IF p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 256
    OR p_tenant IS NULL OR length(p_tenant) NOT BETWEEN 1 AND 128
    OR p_tier NOT IN ('free','plus','premium') THEN
   RAISE EXCEPTION 'Invalid identity provisioning input';
 END IF;
 INSERT INTO public.users (azee_user_id, tenant_id, tier)
 VALUES (p_subject,p_tenant,p_tier)
 ON CONFLICT (azee_user_id) DO UPDATE SET tier=EXCLUDED.tier, updated_at=now()
 WHERE public.users.tenant_id=EXCLUDED.tenant_id
 RETURNING * INTO v_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Identity tenant reassignment refused'; END IF;
 INSERT INTO public.portfolios(user_id,name) VALUES(v_user.id,'Main') ON CONFLICT(user_id,name) DO NOTHING;
 INSERT INTO public.paper_accounts(user_id,cash) VALUES(v_user.id,100000) ON CONFLICT(user_id) DO NOTHING;
 RETURN QUERY SELECT v_user.id,v_user.azee_user_id,v_user.tenant_id,p_tier;
END $$;
REVOKE ALL ON FUNCTION public.aztrade_provision_identity(text,text,text) FROM PUBLIC;
-- REQUIRED MANUAL GRANT after migration: GRANT EXECUTE ON FUNCTION public.aztrade_provision_identity(text,text,text) TO <restricted_app_role>;
COMMIT;
