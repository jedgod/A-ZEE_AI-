# Runbook: inference maintenance worker

**Owner:** the staging owner named in the alert (`ALERT_OWNER`, default `azee-staging-owner`). No on-call rota or paging channel exists yet: alerts are
written to `MAINTENANCE_ALERT_FILE` (JSON lines) and piped to `ALERT_COMMAND` if one is configured. Wire that to a real channel before relying on it.

What the worker does (`scripts/lib/inference-maintenance.cjs`, run every `MAINTENANCE_INTERVAL_MS` by `scripts/staging/maintenance-supervisor.mjs`):
recovers `running` requests older than 5 minutes (marks them failed, refunds the quota exactly once, rotates the attempt id so a late original attempt
cannot charge or refund), clears stored reply text after 7 days, deletes request metadata after 90 days.

| Alert event | Meaning | First actions |
|---|---|---|
| `maintenance_failing` (major) | the worker failed 3+ cycles in a row | check the database is reachable and the role can UPDATE/DELETE the `*_requests` / `*_usage` tables; read the supervisor's stderr; restart the supervisor |
| `quota_reconciliation_mismatch` (critical) | a refund found no usage row: books disagree | **stop and investigate**: compare `linqext_usage` / `aztrade_ai_usage` with the request rows for that user and period; do not re-run until understood. The worker rolled back, so nothing was changed |
| `maintenance_stale` (major) | no successful cycle for longer than `STALE_AFTER_MS` | the supervisor may be down or the DB unreachable; stale requests keep their charge until it runs |
| `maintenance_recovered` (info) | a cycle succeeded after an alert | confirm the backlog metric (`staleRunning`) is falling |

Metrics file (`MAINTENANCE_METRICS_FILE`): `staleRunning` (backlog), `lastStats` (recovered/redacted/deleted), `consecutiveFailures`, `secondsSinceSuccess`.

## Email alerts (prepared, not enabled)
Set `ALERT_COMMAND="node scripts/staging/alert-smtp.mjs"` on the supervisor and provide `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`tls` or `starttls`),
`ALERT_MAIL_FROM`, `ALERT_MAIL_TO` and, if the relay needs it, `SMTP_USER` + `SMTP_PASSWORD_FILE` (a mounted secret file) and `SMTP_CA_FILE`. Until all required
settings exist nothing is sent: the command exits 3 and the supervisor logs `alert_delivery_failed`. No provider is assumed. Verify with a deliberate test
alert after configuring a real relay; the code is only tested against a fake server.
