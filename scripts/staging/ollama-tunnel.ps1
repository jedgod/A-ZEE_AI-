<#
  Restricted REVERSE SSH tunnel: makes this PC's existing Ollama (127.0.0.1:11434) appear on the Oracle host's LOOPBACK (127.0.0.1:11434).
  NOT ACTIVATED BY DEFAULT: without -Activate this only prints the exact command and runs every safety check (a dry run). Nothing connects.

    .\scripts\staging\ollama-tunnel.ps1 -OracleHost 203.0.113.10 -KeyFile ~\.ssh\azee-ollama-tunnel -KnownHostsFile ~\.ssh\azee-oracle.known_hosts           # dry run
    .\scripts\staging\ollama-tunnel.ps1 ... -Activate                                                                                                      # only after approval

  Guarantees enforced here (each one is a refusal, not a warning):
    - strict host-key verification against a PINNED known_hosts file that already contains the host (no trust-on-first-use, no `accept-new`)
    - a DEDICATED identity: the key must differ from the administrative key (~\.ssh\azee-oracle.key) and from any default key
    - the Oracle-side endpoint is 127.0.0.1 only (never 0.0.0.0, never a public bind); the local endpoint is this PC's loopback
    - fail closed: ExitOnForwardFailure + keep-alives; when the tunnel drops, the Oracle-side port disappears and the app refuses AI requests (no fallback exists)
    - restarts with exponential back-off, never with a weaker configuration
#>
param(
  [Parameter(Mandatory)] [string] $OracleHost,
  [string] $User = 'ollama-tunnel',
  [Parameter(Mandatory)] [string] $KeyFile,
  [Parameter(Mandatory)] [string] $KnownHostsFile,
  [int] $Port = 22,
  [int] $LocalPort = 11434,
  [int] $RemotePort = 11434,
  [switch] $Activate
)
$ErrorActionPreference = 'Stop'
function Refuse($why) { Write-Error "REFUSING: $why"; exit 2 }

if ($OracleHost -notmatch '^[A-Za-z0-9.-]{1,253}$') { Refuse 'OracleHost must be a plain host name or IP address' }
if ($User -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { Refuse 'invalid user name' }
if ($User -in 'root', 'opc', 'ubuntu', 'ec2-user') { Refuse "the tunnel must use its own unprivileged account, not '$User'" }
$key = (Resolve-Path -LiteralPath $KeyFile -ErrorAction SilentlyContinue).Path; if (-not $key) { Refuse "key file not found: $KeyFile" }
$known = (Resolve-Path -LiteralPath $KnownHostsFile -ErrorAction SilentlyContinue).Path; if (-not $known) { Refuse "pinned known_hosts file not found: $KnownHostsFile (obtain the host key fingerprint from the Oracle console, pin it, then retry)" }
$admin = Join-Path $env:USERPROFILE '.ssh\azee-oracle.key'
foreach ($bad in @($admin, (Join-Path $env:USERPROFILE '.ssh\id_ed25519'), (Join-Path $env:USERPROFILE '.ssh\id_rsa'))) { if ((Test-Path $bad) -and ((Resolve-Path $bad).Path -ieq $key)) { Refuse 'the tunnel needs a DEDICATED key, not the administrative or a default identity key' } }
$pinned = Get-Content -LiteralPath $known | Where-Object { $_ -match '^\S' -and $_ -notmatch '^\s*#' } | ForEach-Object { ($_ -split '\s+')[0] }
$hostPattern = if ($Port -ne 22) { "[$OracleHost]:$Port" } else { $OracleHost }
if (-not ($pinned | Where-Object { ($_ -split ',') -contains $hostPattern -or ($_ -split ',') -contains $OracleHost })) { Refuse "no pinned host key for $hostPattern in $known (strict host-key checking would fail; pin it from the console, do not accept it blindly)" }
if ($LocalPort -lt 1024 -or $RemotePort -lt 1024) { Refuse 'ports below 1024 are not allowed' }

$sshArgs = @('-N', '-T',
  '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', "UserKnownHostsFile=$known", '-o', 'GlobalKnownHostsFile=NUL',
  '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=15',
  '-o', 'ClearAllForwardings=no', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
  '-i', $key, '-p', "$Port",
  '-R', "127.0.0.1:${RemotePort}:127.0.0.1:${LocalPort}",          # Oracle-side bind is the Oracle host's LOOPBACK only
  "$User@$OracleHost")

Write-Host "Tunnel plan (Oracle 127.0.0.1:$RemotePort  ->  this PC 127.0.0.1:$LocalPort):"
Write-Host ("  ssh " + ($sshArgs -join ' '))
if (-not $Activate) { Write-Host 'DRY RUN: nothing was started. Re-run with -Activate only after the Oracle SSH problem is fixed and the security configuration is approved.'; exit 0 }

if (-not (Get-NetTCPConnection -State Listen -LocalPort $LocalPort -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue)) { Refuse "nothing listens on 127.0.0.1:$LocalPort here (is Ollama running?)" }
$delay = 5
while ($true) {
  $started = Get-Date
  & ssh @sshArgs
  Write-Warning "tunnel ended (exit $LASTEXITCODE); the Oracle-side port is closed, so AI requests fail closed until it is re-established"
  if (((Get-Date) - $started).TotalSeconds -gt 120) { $delay = 5 } else { $delay = [Math]::Min($delay * 2, 300) }   # back off when it keeps failing
  Start-Sleep -Seconds $delay
}
