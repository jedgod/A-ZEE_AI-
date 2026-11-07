-- Account deletion. Everything a user owns is deleted with the account (most tables already
-- cascade from users). Two kinds of record are deliberately kept, minimised and unlinked:
--   * payment records, as accounting rules require: they keep their amounts but lose the user link;
--   * device signals and free-allowance events of an account that had used up its free plan, for
--     up to 90 days under a pseudonymous id ("deleted:<random>"), so deleting and re-registering
--     can't be used to get a fresh free allowance.

ALTER TABLE device_signals DROP CONSTRAINT IF EXISTS device_signals_user_id_fkey;
ALTER TABLE free_quota_events DROP CONSTRAINT IF EXISTS free_quota_events_user_id_fkey;

ALTER TABLE payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
