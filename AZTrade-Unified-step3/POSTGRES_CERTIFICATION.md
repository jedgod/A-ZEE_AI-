# PostgreSQL 16 certification — NOT YET PASSED

## Safety prerequisites

Use a newly created **disposable** PostgreSQL 16 database, isolated from production and real user data. Do not run migrations against an existing database without a migration review and backup. Run schema.sql, then migrations 001–005 in order using a dedicated migration owner. **Never** connect the application with that owner, a superuser, or a role with BYPASSRLS. Set up a restricted application role with only required privileges and verify inherited privileges.

## Run

Install dependencies with `cd backend && npm ci` if a lockfile exists; otherwise `npm install` in the isolated test environment. Configure `AZTRADE_CERT_DATABASE_URL` to the disposable database URL for the **restricted app role**, and set `AZTRADE_CERT_DISPOSABLE=YES`. Then run `bash scripts-certify.sh`.

## Coverage

The new tests inspect PostgreSQL 16 version, nine FORCE RLS tables, role ownership and BYPASSRLS, unscoped access, transaction-local context, cross-tenant writes, and ledger update/delete denial. They do not yet certify actual concurrent order execution, successful balanced postings, cash/position reconciliation, database restart, failover, backups, or application E2E. Those require a full test harness, seeded isolated users and operational infrastructure. Never interpret these tests as full production certification.

## Important

The current paper ledger represents cash/position value transfers but does not independently establish cash balances from a trusted opening-balance ledger. The ledger requires stronger financial model validation and reconciliation before enabling execution. Do not set `AZTRADE_PAPER_EXECUTION_CERTIFIED=true` on the basis of this package.
