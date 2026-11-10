<#
  Runs the whole AZTrade PostgreSQL certification against a brand-new, disposable PostgreSQL 16 cluster.

    .\scripts\run-certification.ps1 -PgBin 'G:\pg16-cert\x\pgsql\bin' -Work 'G:\pg16-cert\run1'

  It creates a NEW data directory (refuses an existing one), binds the server to 127.0.0.1 on a dedicated port,
  creates the three least-privilege roles, applies schema + migrations 001-006 + grants, runs every cert-* suite as the
  RESTRICTED application role, and always stops the server at the end. Nothing here touches any other database.
#>
param(
  [Parameter(Mandatory)] [string] $PgBin,
  [Parameter(Mandatory)] [string] $Work,
  [int] $Port = 54329,
  [switch] $KeepRunning,
  [switch] $Negative      # run the negative controls (deliberately broken procedure must make the suites fail) instead of the suites
)
$ErrorActionPreference = 'Stop'
if ($Port -eq 5432) { throw 'Refusing the default PostgreSQL port; use a dedicated port.' }
$data = Join-Path $Work 'data'
if (Test-Path $data) { throw "Refusing to reuse an existing data directory: $data" }
New-Item -ItemType Directory -Force $Work | Out-Null
$exe = { param($n) $p = Join-Path $PgBin $n; if (-not (Test-Path $p)) { throw "missing $p" }; $p }
$initdb = & $exe 'initdb.exe'; $pgctl = & $exe 'pg_ctl.exe'

$adminPw = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$pwFile = Join-Path $Work 'admin.pw'; Set-Content -Path $pwFile -Value $adminPw -NoNewline
& $initdb -D $data -U postgres --auth=scram-sha-256 --pwfile=$pwFile -E UTF8 --locale=C | Out-Null
Remove-Item $pwFile -Force
# Small, safe settings for a throwaway instance; durability settings stay at their defaults on purpose (crash recovery is tested).
Add-Content (Join-Path $data 'postgresql.conf') "`nlisten_addresses = '127.0.0.1'`nport = $Port`nshared_buffers = 128MB`nmax_connections = 60`nlog_min_messages = warning`n"

$log = Join-Path $Work 'postgres.log'
# Neither a pipeline nor Start-Process -Wait: on Windows PowerShell both also wait for the server (a child of pg_ctl),
# which never exits. Start it without waiting and poll the port instead.
$null = Start-Process -FilePath $pgctl -ArgumentList @('-D', $data, '-l', $log, 'start') -WindowStyle Hidden -PassThru
$deadline = (Get-Date).AddSeconds(90)
while (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
  if ((Get-Date) -gt $deadline) { throw "PostgreSQL did not start; see $log" }
  Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 2   # let the postmaster finish recovery and start accepting connections
$ok = $false
try {
  $env:AZTRADE_CERT_DISPOSABLE = 'YES'
  $env:AZTRADE_CERT_ADMIN_URL = "postgres://postgres:$adminPw@127.0.0.1:$Port/postgres"
  $env:AZTRADE_CERT_OUT = Join-Path $Work 'cert-config.json'
  $env:AZTRADE_CERT_PGCTL = $pgctl
  $env:AZTRADE_CERT_DATADIR = $data
  $env:AZTRADE_CERT_CONFIG = $env:AZTRADE_CERT_OUT
  Push-Location (Join-Path $PSScriptRoot '..')
  node scripts/cert-provision.mjs
  if ($LASTEXITCODE -ne 0) { throw 'provisioning failed' }
  $cfg = Get-Content $env:AZTRADE_CERT_OUT -Raw | ConvertFrom-Json
  $env:AZTRADE_CERT_DATABASE_URL = $cfg.appUrl      # the original suite, as the restricted application role
  if ($Negative) {
    node scripts/negative-controls.mjs
    $ok = ($LASTEXITCODE -eq 0)
    return
  }
  $report = Join-Path $Work 'certification-report.tap'
  node --test --test-reporter=tap --test-concurrency=1 `
    tests/postgres-certification.test.js tests/cert-posting.test.js tests/cert-concurrency.test.js tests/cert-http.test.js tests/cert-marketdata.test.js tests/cert-restart.test.js tests/cert-identity.test.js tests/cert-backup.test.js 2>&1 |
    Tee-Object -FilePath $report | Select-String '^# (tests|pass|fail|skipped|cancelled)|^not ok'
  $ok = ($LASTEXITCODE -eq 0)
  "report: $report"
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  if (-not $KeepRunning) {
    $stop = Start-Process -FilePath $pgctl -ArgumentList @('-D', $data, '-m', 'fast', 'stop') -WindowStyle Hidden -PassThru
    [void]$stop.WaitForExit(60000)
    while (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }
    'server stopped'
  }
}
if (-not $ok) { exit 1 }
