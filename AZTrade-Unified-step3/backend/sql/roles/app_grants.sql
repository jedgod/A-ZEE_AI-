-- Least-privilege grants. Run as the migration owner AFTER migrations 001-006.
-- The tokens {{APP_ROLE}}, {{PROVISIONER_ROLE}} and {{MARKETDATA_ROLE}} are replaced by scripts/cert-provision.mjs (identifiers are validated).
--
-- {{APP_ROLE}} is what the API connects as at runtime. It owns nothing, has no BYPASSRLS, and can NOT write
-- cash, positions, orders or the ledger directly: the only way to move paper money is aztrade_place_paper_order().
-- {{PROVISIONER_ROLE}} is the account-provisioning service (A-Zee identity -> internal user, portfolio, paper account).

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO {{APP_ROLE}}, {{PROVISIONER_ROLE}}, {{MARKETDATA_ROLE}};

-- Runtime application role.
GRANT SELECT ON instruments, market_prices, market_prices_fresh, market_data_sources TO {{APP_ROLE}};
GRANT SELECT ON users TO {{APP_ROLE}};
GRANT SELECT, INSERT ON portfolios TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE, DELETE ON holdings TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE ON alerts TO {{APP_ROLE}};
GRANT SELECT, INSERT ON assistant_messages TO {{APP_ROLE}};
GRANT SELECT ON paper_accounts, paper_positions, paper_orders, paper_ledger TO {{APP_ROLE}};
GRANT EXECUTE ON FUNCTION aztrade_place_paper_order(text, text, numeric, text, text) TO {{APP_ROLE}};
GRANT EXECUTE ON FUNCTION aztrade_reconcile_paper_account(uuid) TO {{APP_ROLE}};
GRANT EXECUTE ON FUNCTION aztrade_user_id(), aztrade_tenant_id(), aztrade_is_owner(uuid) TO {{APP_ROLE}};

-- Provisioning service: creates the identity mapping and the accounts, nothing else.
GRANT SELECT, INSERT ON users, portfolios, paper_accounts TO {{PROVISIONER_ROLE}};
GRANT SELECT ON instruments, market_prices TO {{PROVISIONER_ROLE}};
GRANT EXECUTE ON FUNCTION aztrade_user_id(), aztrade_tenant_id(), aztrade_is_owner(uuid) TO {{PROVISIONER_ROLE}};

-- Market-data ingestion: writes prices WITH provenance, nothing else. It cannot register or relicense a source (that is an
-- owner decision), cannot touch users, accounts, orders or the ledger, and the FK stops it naming an unregistered source.
GRANT SELECT ON instruments, market_data_sources TO {{MARKETDATA_ROLE}};
GRANT SELECT, INSERT, UPDATE ON market_prices TO {{MARKETDATA_ROLE}};

-- Only the authenticated application may invoke identity provisioning.
GRANT EXECUTE ON FUNCTION aztrade_provision_identity(text,text,text) TO {{APP_ROLE}};
