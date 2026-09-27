<#
.SYNOPSIS
  Starts a throwaway, zero-config Lore server for tests and spikes.

.DESCRIPTION
  Ephemeral store (temp folder), self-signed certificate, auth disabled. Used only by the
  vitest backend-contract suite and Phase 0 spike scripts. For day-to-day dogfooding use
  start-dev-server.ps1 instead, which is persistent.

  Uses ports 41337 (QUIC/gRPC) and 41339 (HTTP health check), same as the dev server, so only
  one of the two can run at a time.
#>

$ErrorActionPreference = 'Stop'

$healthUrl = 'http://127.0.0.1:41339/health_check'
$pidFile = Join-Path $env:TEMP 'lore-vscode-test-server.pid'
$dataDir = Join-Path $env:TEMP ('lore-vscode-test-server-' + [guid]::NewGuid().ToString('N'))

function Test-ServerHealthy {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-ServerHealthy) {
  Write-Host "A Lore server is already running and healthy at $healthUrl. Not starting a second one."
  exit 0
}

$loreserver = Get-Command loreserver.exe -ErrorAction SilentlyContinue
if (-not $loreserver) {
  Write-Error @"
loreserver.exe was not found on PATH.

This script cannot install it for you. Please install it yourself following Lore's
Quickstart, Step 1 (https://epicgames.github.io/lore/tutorials/quickstart/), so that
loreserver.exe ends up next to lore.exe (normally %USERPROFILE%\bin), then re-run this script.
"@
  exit 1
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

Write-Host "Starting throwaway Lore server (data dir: $dataDir)..."

# NOTE (unverified pending loreserver install, see docs/spike-findings.md):
# "Zero-config" is assumed to mean: no --config argument, an ephemeral self-signed
# certificate, and the store rooted at the process's working directory. Verify this
# against `loreserver --help` the first time loreserver.exe is available, and update this
# script (and docs/spike-findings.md) if the real invocation differs.
$process = Start-Process -FilePath $loreserver.Source `
  -WorkingDirectory $dataDir `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $dataDir 'loreserver.out.log') `
  -RedirectStandardError (Join-Path $dataDir 'loreserver.err.log')

Set-Content -Path $pidFile -Value $process.Id
Set-Content -Path (Join-Path $env:TEMP 'lore-vscode-test-server.datadir') -Value $dataDir

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if (Test-ServerHealthy) {
    Write-Host "Lore test server is healthy at $healthUrl (pid $($process.Id))."
    exit 0
  }
  if ($process.HasExited) {
    Write-Error "loreserver exited early. See $dataDir\loreserver.err.log"
    exit 1
  }
  Start-Sleep -Milliseconds 500
}

Write-Error "Timed out waiting for $healthUrl to become healthy. See $dataDir\loreserver.err.log"
exit 1
