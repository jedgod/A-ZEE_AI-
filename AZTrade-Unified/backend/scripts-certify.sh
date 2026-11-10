#!/usr/bin/env bash
set -euo pipefail
: "${AZTRADE_CERT_DATABASE_URL:?Set disposable PostgreSQL 16 URL with restricted app role}"
: "${AZTRADE_CERT_DISPOSABLE:?Set AZTRADE_CERT_DISPOSABLE=YES after verifying isolation}"
if [[ "$AZTRADE_CERT_DISPOSABLE" != YES ]]; then echo 'Refusing non-disposable database' >&2; exit 1; fi
cd "$(dirname "$0")"
node --test tests/postgres-certification.test.js
