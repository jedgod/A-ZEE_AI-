-- Trusted migration owner only. The identity index is private to this definer.
BEGIN;
CREATE TABLE IF NOT EXISTS public.aztrade_identity_index (
 subject text PRIMARY KEY,
 user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
 tenant_id text
);
REVOKE ALL ON public.aztrade_identity_index FROM PUBLIC;
-- Backfill legacy identities under an exclusive migration transaction; restore FORCE before commit.
ALTER TABLE public.users NO FORCE ROW LEVEL SECURITY;
INSERT INTO public.aztrade_identity_index(subject,user_id,tenant_id)
 SELECT azee_user_id,id,tenant_id FROM public.users ON CONFLICT(subject) DO NOTHING;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.aztrade_provision_identity(p_subject text,p_tenant text,p_tier text)
RETURNS TABLE(id uuid,azee_user_id text,tenant_id text,tier text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; v_tenant text; v_exists boolean;
 old_user text := current_setting('app.current_user_id',true);
 old_tenant text := current_setting('app.current_tenant',true);
BEGIN
 IF p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 256 OR
    p_tenant IS NULL OR length(btrim(p_tenant)) NOT BETWEEN 1 AND 128 OR
    p_tier IS NULL OR p_tier NOT IN ('free','plus','premium') THEN
  RAISE EXCEPTION 'Invalid identity' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_subject,73128));
 SELECT i.user_id,i.tenant_id INTO v_id,v_tenant FROM public.aztrade_identity_index i WHERE i.subject=p_subject;
 v_exists := FOUND;
 IF v_exists AND v_tenant IS DISTINCT FROM p_tenant THEN
  RAISE EXCEPTION 'Identity tenant reassignment refused' USING ERRCODE='42501';
 END IF;
 IF NOT v_exists THEN v_id := gen_random_uuid(); END IF;
 PERFORM set_config('app.current_user_id',v_id::text,true);
 PERFORM set_config('app.current_tenant',p_tenant,true);
 INSERT INTO public.users(id,azee_user_id,tenant_id,tier) VALUES(v_id,p_subject,p_tenant,p_tier)
 ON CONFLICT ON CONSTRAINT users_azee_user_id_key DO UPDATE SET tier=EXCLUDED.tier,updated_at=now()
 WHERE users.id=v_id AND users.tenant_id=p_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Identity binding refused' USING ERRCODE='42501'; END IF;
 INSERT INTO public.aztrade_identity_index(subject,user_id,tenant_id) VALUES(p_subject,v_id,p_tenant)
 ON CONFLICT(subject) DO NOTHING;
 INSERT INTO public.portfolios(user_id,name) VALUES(v_id,'Main') ON CONFLICT(user_id,name) DO NOTHING;
 INSERT INTO public.paper_accounts(user_id,cash) VALUES(v_id,100000) ON CONFLICT(user_id) DO NOTHING;
 PERFORM set_config('app.current_user_id',coalesce(old_user,''),true);
 PERFORM set_config('app.current_tenant',coalesce(old_tenant,''),true);
 RETURN QUERY SELECT v_id,p_subject,p_tenant,p_tier;
END $$;
REVOKE ALL ON FUNCTION public.aztrade_provision_identity(text,text,text) FROM PUBLIC;
COMMIT;
