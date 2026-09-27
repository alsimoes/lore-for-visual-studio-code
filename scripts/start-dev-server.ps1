<#
.SYNOPSIS
  Starts (or confirms) a persistent local Lore server for daily dogfooding use.

.DESCRIPTION
  Unlike start-test-server.ps1, this server keeps its store across restarts. It follows
  Lore's "Deploy a local Lore Server" how-to: a stable config directory at
  C:\loreserver\config, a store at C:\loreserver\store, and a stable QUIC certificate.

  This script creates C:\loreserver\config\local.toml only if it doesn't already exist. It
  never overwrites an existing config, and it never runs anything outside this check without
  telling you first.

  NOTE: the maintainer's actual daily-use server is lore://argoneon:41337 (a separate,
  already-running machine) rather than this script's localhost server. This script exists for
  the case where the extension is used against a local server per PLAN.md §7 Phase 0, task 2 —
  run it only if you specifically want a server on this machine.
#>

$ErrorActionPreference = 'Stop'

$healthUrl = 'http://127.0.0.1:41339/health_check'
$configDir = 'C:\loreserver\config'
$configFile = Join-Path $configDir 'local.toml'
$storeDir = 'C:\loreserver\store'

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

if (-not (Test-Path $configFile)) {
  Write-Host "No config found at $configFile."
  $answer = Read-Host "Create $configDir and $storeDir and write a new local.toml there? [y/N]"
  if ($answer -ne 'y' -and $answer -ne 'Y') {
    Write-Host 'Aborted. No files were created.'
    exit 1
  }

  New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  New-Item -ItemType Directory -Force -Path $storeDir | Out-Null

  # NOTE (unverified pending loreserver install, see docs/spike-findings.md): the exact TOML
  # schema for the QUIC certificate and any other required keys must be checked against
  # loreserver's "Deploy a local Lore Server" how-to and loreserver --help once the binary is
  # available, and this template updated to match.
  $storeDirToml = $storeDir -replace '\\', '\\\\'
  @"
[immutable_store.local]
path = "$storeDirToml"

[mutable_store.local]
path = "$storeDirToml"
"@ | Set-Content -Path $configFile

  Write-Host "Wrote $configFile."
} else {
  Write-Host "Using existing config at $configFile (never overwritten by this script)."
}

Write-Host 'Starting persistent Lore server...'
$process = Start-Process -FilePath $loreserver.Source `
  -ArgumentList @('--config', $configDir) `
  -PassThru -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if (Test-ServerHealthy) {
    Write-Host "Lore dev server is healthy at $healthUrl (pid $($process.Id))."
    exit 0
  }
  if ($process.HasExited) {
    Write-Error 'loreserver exited early.'
    exit 1
  }
  Start-Sleep -Milliseconds 500
}

Write-Error "Timed out waiting for $healthUrl to become healthy."
exit 1
