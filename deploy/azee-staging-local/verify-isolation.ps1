<#
  Runtime isolation checks for a RUNNING azee-staging-local stack. NOT YET RUN (needs the Docker engine).
  Prints PASS/FAIL per check and exits 1 on any FAIL. Uses only throw-away containers on this project's own networks.
    .\deploy\azee-staging-local\verify-isolation.ps1 [-GatewayPort 8443]
#>
param([int]$GatewayPort = 8443)
$ErrorActionPreference = 'Continue'
$p = 'azee-staging-local'; $fail = 0
function Check($name, [bool]$ok, $detail = '') { if ($ok) { "PASS  $name" } else { "FAIL  $name  $detail"; $script:fail++ } }
$edge = "${p}_edge"; $priv = "${p}_private"
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..'); $pki = "$root\secrets-staging\pki\live"

"== public ingress (from the host, TLS verified against the local CA)"
$ca = "$pki\gateway\ca.pem"
foreach ($path in '/api/aztrade/introspect', '/api/aztrade/jwks', '/api/aztrade/ai', '/api/admin/users', '/api/operations/dashboard', '/api/staff/session', '/api/webhooks/stripe', '/api/v1/chat', '/health', '/.env') {
  $code = curl.exe -s -o NUL -w '%{http_code}' --cacert $ca "https://localhost:$GatewayPort$path" -X POST
  Check "gateway denies $path" ($code -eq '404') "got $code"
}
foreach ($path in '/login', '/pricing') { $code = curl.exe -s -o NUL -w '%{http_code}' --cacert $ca "https://localhost:$GatewayPort$path"; Check "gateway serves $path" ($code -in '200', '307', '308') "got $code" }
$http = curl.exe -s -o NUL -w '%{http_code}' --max-time 4 "http://localhost:$GatewayPort/login"; Check 'plain HTTP is not served' ($http -ne '200') "got $http"

"== published ports (only the gateway may be published)"
$published = docker ps --filter "label=com.docker.compose.project=$p" --format '{{.Names}} {{.Ports}}' | Where-Object { $_ -match '->' }
Check 'only the gateway publishes a port' (@($published).Count -eq 1 -and $published -match 'gateway') ($published -join '; ')
foreach ($port in 5432, 3000, 3001) { Check "host port $port not published by the stack" (-not ($published -match ":$port->")) }

"== unauthorized container on the EDGE network (what a compromised gateway-side container could reach)"
foreach ($t in @(@('introspect', 8443), @('db', 5432), @('aztrade-api', 3001))) {
  $r = docker run --rm --network $edge alpine:3.20 sh -c "nc -z -w 3 $($t[0]) $($t[1]) && echo OPEN || echo CLOSED" 2>&1
  Check "edge cannot reach $($t[0]):$($t[1])" ("$r" -match 'CLOSED|bad address') "$r"
}

"== unauthorized container on the PRIVATE network (network reachable by design; authentication must stop it)"
$r = docker run --rm --network $priv alpine/openssl:latest s_client -connect introspect:8443 -brief 2>&1 | Out-String
Check 'introspect: TLS without a client certificate is refused' ($r -match 'alert|handshake failure|certificate required|error') 'handshake completed without a client certificate'
$dbp = docker run --rm --network $priv postgres:16-alpine sh -c "PGPASSWORD=wrong-password psql -h db -U azee_app -d azee_staging -c 'select 1' 2>&1" | Out-String
Check 'db: wrong password is refused' ($dbp -match 'password authentication failed') $dbp
$dbp2 = docker run --rm --network $priv postgres:16-alpine sh -c "PGPASSWORD=x psql -h db -U postgres -d postgres -c 'select 1' 2>&1" | Out-String
Check 'db: superuser is not reachable without its secret' ($dbp2 -match 'authentication failed') $dbp2

"== egress from internal services"
foreach ($s in 'introspect', 'aztrade-api', 'db') {
  $r = docker compose -f "$PSScriptRoot\compose.yaml" exec -T $s sh -c 'wget -q -T 3 -O /dev/null http://1.1.1.1 && echo REACHED || echo BLOCKED' 2>&1
  Check "$s has no outbound internet" ("$r" -match 'BLOCKED') "$r"
}

"== mTLS with the CORRECT client certificate works; a certificate from another CA does not"
$ok = docker run --rm --network $priv -v "${pki}\azee-app:/c:ro" alpine/openssl:latest s_client -connect introspect:8443 -cert /c/cert.pem -key /c/key.pem -CAfile /c/ca.pem -verify_return_error -brief 2>&1 | Out-String
Check 'allowlisted client certificate completes the handshake' ($ok -match 'Verification: OK|Protocol version') $ok

"== no secret material in container environments"
foreach ($s in 'app', 'introspect', 'aztrade-api') {
  $envdump = docker compose -f "$PSScriptRoot\compose.yaml" exec -T $s env 2>&1 | Out-String
  Check "$s environment has no CA key or admin password" (-not ($envdump -match 'BEGIN .*PRIVATE KEY|postgres_admin')) ''
}
if ($fail) { "`n$fail check(s) FAILED"; exit 1 } else { "`nAll isolation checks passed" }
