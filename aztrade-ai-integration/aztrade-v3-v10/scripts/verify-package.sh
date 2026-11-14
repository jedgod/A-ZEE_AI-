#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --test "$ROOT"/backend/tests/*.test.js
printf '\nPASSED: standalone pure-module tests. This does NOT certify A-Zee integration.\n'
