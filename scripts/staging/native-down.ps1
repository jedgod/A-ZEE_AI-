param([string]$Base = 'G:\A-Z_AI\staging-local', [switch]$IncludeDatabase)
# Stops ONLY the processes recorded by native-up.ps1 (and, with -IncludeDatabase, the staging PostgreSQL on port 54400).
$f = "$Base\pids.json"
if (Test-Path $f) { (Get-Content $f -Raw | ConvertFrom-Json).PSObject.Properties | % { $p = Get-Process -Id $_.Value -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id $p.Id -Force; "stopped $($_.Name) ($($_.Value))" } }; Remove-Item $f }
if ($IncludeDatabase) { & 'G:\pg16-cert\x\pgsql\bin\pg_ctl.exe' -D "$Base\pgdata" -m fast stop }
