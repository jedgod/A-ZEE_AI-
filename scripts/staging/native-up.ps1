<#
  NATIVE (no Docker) azee-staging-local services. LOCAL ONLY, disposable credentials, not production.
  Prereqs (done once): secrets + CA generated, PostgreSQL 16 running on 127.0.0.1:54400 and bootstrapped, `npm run build` done.
    .\scripts\staging\native-up.ps1 [-Base G:\A-Z_AI\staging-local] [-LanIp 10.0.0.237] [-GatewayPort 8443]
  Binds: introspect 127.0.0.1:18443 (mTLS), aztrade-api 127.0.0.1:3001, app 127.0.0.1:3000, gateway <LanIp>:<GatewayPort> (the only LAN-facing port).
  Stop with native-down.ps1. Isolation here is loopback binding + mTLS/auth, NOT container networking.
#>
param([string]$Base = 'G:\A-Z_AI\staging-local', [string]$LanIp = '10.0.0.237', [int]$GatewayPort = 8443,
      [ValidateSet('', 'introspect', 'aztrade-api', 'app', 'gateway')][string]$Only = '')   # -Only restarts a single service (others keep running)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..'); $sec = "$Base\secrets"; $pki = "$Base\pki\live"; $log = "$Base\logs"
$secret = { param($n) (Get-Content "$sec\$n" -Raw).Trim() }
$pidFile = "$Base\pids.json"; $pids = @{}
if ($Only -and (Test-Path $pidFile)) { (Get-Content $pidFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $pids[$_.Name] = $_.Value } }
$ports = @{ 'introspect' = 18443; 'aztrade-api' = 3001; 'app' = 3000; 'gateway' = $GatewayPort }
foreach ($e in $ports.GetEnumerator()) { if ((-not $Only -or $e.Key -eq $Only) -and (Get-NetTCPConnection -State Listen -LocalPort $e.Value -ErrorAction SilentlyContinue)) { throw "port $($e.Value) is already in use" } }
$origin = "https://${LanIp}:$GatewayPort"

function Start-Svc($name, $exe, $argList, $dir, $envMap) {
  if ($Only -and $Only -ne $name) { return }
  $saved = @{}; foreach ($k in $envMap.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envMap[$k]) }
  try { $p = Start-Process $exe -ArgumentList $argList -WorkingDirectory $dir -PassThru -WindowStyle Hidden -RedirectStandardOutput "$log\$name.out.log" -RedirectStandardError "$log\$name.err.log" }
  finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
  $script:pids[$name] = $p.Id; "$name started (pid $($p.Id))"
}

# 1. private mTLS identity listener (loopback only)
Start-Svc 'introspect' 'node' @('--experimental-transform-types', '--no-warnings', 'scripts/introspect-listener.mjs') $root @{
  NODE_ENV = 'production'; AZEE_ENV = 'azee-staging-local'; AZEE_SECRET_PROVIDER = 'file'; AZEE_SECRETS_DIR = $sec
  AZEE_JWT_ISSUER = $origin; AZTRADE_JWT_KID = 'azee-staging-local-1'
  AZTRADE_MTLS_SERVER_CERT_FILE = "$pki\introspect\cert.pem"; AZTRADE_MTLS_SERVER_KEY_FILE = "$pki\introspect\key.pem"
  AZTRADE_MTLS_CLIENT_CA_FILE = "$pki\introspect\ca.pem"; AZTRADE_MTLS_CRL_FILE = "$pki\introspect\ca.crl"
  AZTRADE_MTLS_ALLOWED_CLIENT_CNS = 'aztrade-api,azee-app'; AZTRADE_MTLS_LISTEN_HOST = '127.0.0.1'; AZTRADE_MTLS_PORT = '18443' }

# 2. AZTrade API (loopback only; identity ONLY through the mTLS listener)
Start-Svc 'aztrade-api' 'node' @('server.js') 'G:\A-Z_AI\AZTrade\backend' @{
  NODE_ENV = 'production'; AUTH_MODE = 'jwt'; PORT = '3001'; HOST = '127.0.0.1'
  DATABASE_URL = (& $secret 'AZTRADE_API_DATABASE_URL'); AZEE_INTROSPECTION_TOKEN = (& $secret 'AZTRADE_SERVICE_SECRET')
  AZEE_JWT_ISSUER = $origin; AZEE_JWT_AUDIENCE = 'aztrade-api'
  AZEE_JWKS_URL = 'https://localhost:18443/jwks'; AZEE_INTROSPECTION_URL = 'https://localhost:18443/introspect'
  AZEE_INTROSPECTION_MTLS_CERT_FILE = "$pki\aztrade-api\cert.pem"; AZEE_INTROSPECTION_MTLS_KEY_FILE = "$pki\aztrade-api\key.pem"; AZEE_INTROSPECTION_MTLS_CA_FILE = "$pki\aztrade-api\ca.pem"
  CORS_ORIGIN = $origin }

# 3. A-Zee Next.js app (loopback only). Provider keys are blanked so .env.local's real keys are NOT used: AI fails closed.
$blank = @{}; foreach ($k in 'GEMINI_API_KEY', 'GROQ_API_KEY', 'MISTRALAI_API_KEY', 'OPENAI_API_KEY', 'OPENROUTERAI_API_KEY', 'TOGETHERAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'TAVILY_API_KEY') { $blank[$k] = '' }
Start-Svc 'app' 'node' @('--require', './scripts/windows-fs-compat.cjs', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000') $root ($blank + @{
  NODE_ENV = 'production'; DB_DIALECT = 'postgres'; APP_ORIGIN = $origin; NEXT_TELEMETRY_DISABLED = '1'
  DATABASE_URL = (& $secret 'AZEE_DATABASE_URL'); AZTRADE_SERVICE_SECRET = (& $secret 'AZTRADE_SERVICE_SECRET'); AZTRADE_JWT_PRIVATE_KEY = (& $secret 'AZTRADE_JWT_PRIVATE_KEY')
  AZEE_JWT_ISSUER = $origin; AZTRADE_JWT_KID = 'azee-staging-local-1' })

# 4. gateway: the ONLY LAN-facing listener
Start-Svc 'gateway' 'node' @('scripts/staging/gateway.mjs') $root @{ GATEWAY_BIND = $LanIp; GATEWAY_PORT = "$GatewayPort"; APP_URL = 'http://127.0.0.1:3000'; GATEWAY_TLS_DIR = "$pki\gateway" }

$pids | ConvertTo-Json | Set-Content "$Base\pids.json"
Start-Sleep 8
foreach ($p in 18443, 3001, 3000, $GatewayPort) { "{0,-6} {1}" -f $p, $(if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { (Get-NetTCPConnection -State Listen -LocalPort $p | % { "$($_.LocalAddress)" }) -join ',' } else { 'NOT LISTENING' }) }
"Gateway: $origin   CA to trust on test devices: $pki\gateway\ca.pem"
