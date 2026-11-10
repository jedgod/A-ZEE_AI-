-- Inventory only: NOT proof of isolation. Test under a restricted app role.
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public'
ORDER BY tablename,policyname;
