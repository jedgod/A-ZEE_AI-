<#
  Lets phones and other computers on the SAME Wi-Fi/subnet reach the A-Zee development servers on this PC.
  Run it once from an ADMINISTRATOR PowerShell:

      powershell -ExecutionPolicy Bypass -File scripts\lan-firewall.ps1            # add the rules
      powershell -ExecutionPolicy Bypass -File scripts\lan-firewall.ps1 -Remove     # take them away again

  It opens only two TCP ports, only to the local subnet (never the internet), on any network profile:
      3001  the A-Zee web server (npm run dev:lan)
      8081  Metro, which serves the app's JavaScript to a development build
  Nothing else is opened. The AZTrade backend (4010) and its database (54329) stay private to this PC.
#>
param([switch] $Remove)
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this from an administrator PowerShell.' }

$rules = @(
  @{ Name = 'AZ-Zee dev web 3001 (LAN only)'; Port = 3001 },
  @{ Name = 'AZ-Zee dev Metro 8081 (LAN only)'; Port = 8081 }
)
foreach ($r in $rules) {
  Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if (-not $Remove) {
    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Protocol TCP -LocalPort $r.Port -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
    Write-Host "Allowed TCP $($r.Port) from the local subnet."
  } else { Write-Host "Removed: $($r.Name)" }
}
