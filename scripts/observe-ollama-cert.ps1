param([int]$DurationSeconds = 300)
$ErrorActionPreference = 'Stop'
# Socket metadata and working sets only. This is NOT packet capture or proof of
# absence of short-lived/UDP/DNS traffic. Run concurrently with ollama-live.test.ts.
$root = Split-Path -Parent $PSScriptRoot
$serverId = [int](Get-Content -LiteralPath (Join-Path $root 'runtime-logs/ollama-cert/server.pid'))
$evidencePath = Join-Path $root 'docs/evidence/ollama-live.json'
$outputPath = Join-Path $root 'docs/evidence/ollama-network-observation.json'
$samples = [System.Collections.Generic.List[object]]::new()
$started = [DateTime]::UtcNow
$deadline = $started.AddSeconds($DurationSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($serverId)
  $evidence = $null
  if (Test-Path -LiteralPath $evidencePath) {
    try { $evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json; [void]$ids.Add([int]$evidence.processId) } catch {}
  }
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'ollama.exe' OR Name = 'node.exe'")
  for ($depth=0; $depth -lt 4; $depth++) {
    foreach ($entry in $processes) { if ($ids.Contains([int]$entry.ParentProcessId)) { [void]$ids.Add([int]$entry.ProcessId) } }
  }
  $connections = @(netstat -ano -p tcp | ForEach-Object {
    $parts = $_.Trim() -split '\s+'
    if ($parts.Length -eq 5 -and $parts[0] -eq 'TCP' -and $ids.Contains([int]$parts[4])) {
      [pscustomobject]@{ local=$parts[1]; remote=$parts[2]; state=$parts[3]; processId=[int]$parts[4] }
    }
  })
  $memory = @(foreach ($processId in $ids) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) { [pscustomobject]@{ processId=$processId; name=$process.ProcessName; workingSetBytes=$process.WorkingSet64; cpuSeconds=$process.CPU } }
  })
  $samples.Add([pscustomobject]@{ at=[DateTime]::UtcNow.ToString('o'); connections=$connections; processes=$memory })
  if ($evidence -and $evidence.finishedAt -and [DateTime]$evidence.finishedAt -gt $started) { break }
  Start-Sleep -Seconds 1
}
[pscustomobject]@{ startedAt=$started.ToString('o'); finishedAt=[DateTime]::UtcNow.ToString('o');
  method='OS netstat TCP snapshots plus process working sets';
  limitation='Not packet capture; short-lived connections and UDP/DNS can be missed; no firewall enforcement; scope is certification worker and isolated Ollama process tree';
  samples=$samples } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Output "Saved $($samples.Count) network/process observations to $outputPath"
