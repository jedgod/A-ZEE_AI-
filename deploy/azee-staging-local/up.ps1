<#
  Brings up azee-staging-local. LOCAL ONLY. Does not touch any other container, network, volume or port.
  Run from the repository root:   .\deploy\azee-staging-local\up.ps1  [-GatewayBind 127.0.0.1] [-GatewayPort 8443] [-LanIp 192.168.x.y]
  -LanIp adds that address to the gateway certificate AND publishes the gateway on it (needed for a physical phone). Default: loopback only.
  Refuses to start if the chosen gateway port is already in use, or the Docker engine is not running.
#>
param([string]$GatewayBind = '127.0.0.1', [int]$GatewayPort = 8443, [string]$LanIp = '')
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$stack = $PSScriptRoot
Set-Location $root

docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The Docker engine is not running. Start Docker Desktop (see README: memory requirements) and retry.' }
if (Get-NetTCPConnection -State Listen -LocalPort $GatewayPort -ErrorAction SilentlyContinue) { throw "Port $GatewayPort is already in use; choose another with -GatewayPort." }
if ($LanIp) { $GatewayBind = $LanIp; $env:AZEE_GATEWAY_SANS = "IP:$LanIp" }

# 1. disposable secrets + private CA (idempotent; never overwrites)
if (-not (Test-Path "$root\secrets-staging\AZTRADE_SERVICE_SECRET")) { node scripts/staging/make-secrets.mjs | Out-Null }
if (-not (Test-Path "$root\secrets-staging\pki\ca\ca.key")) { node scripts/staging/pki.mjs init --dir secrets-staging/pki | Out-Null } else { node scripts/staging/pki.mjs rotate --dir secrets-staging/pki | Out-Null }

# 2. stack
$env:GATEWAY_BIND = $GatewayBind; $env:GATEWAY_PORT = "$GatewayPort"; $env:GATEWAY_HOST = if ($LanIp) { $LanIp } else { 'localhost' }
$env:PKI_DIR = "$root\secrets-staging\pki"
docker compose -f "$stack\compose.yaml" up -d --build
docker compose -f "$stack\compose.yaml" ps
"Gateway: https://$($env:GATEWAY_HOST):$GatewayPort   CA to trust on test devices: $root\secrets-staging\pki\live\gateway\ca.pem"
