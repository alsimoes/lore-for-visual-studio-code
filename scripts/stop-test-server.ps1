<#
.SYNOPSIS
  Stops the throwaway Lore server started by start-test-server.ps1, and removes its ephemeral
  data directory.
#>

$ErrorActionPreference = 'Stop'

$pidFile = Join-Path $env:TEMP 'lore-vscode-test-server.pid'
$dataDirFile = Join-Path $env:TEMP 'lore-vscode-test-server.datadir'

if (-not (Test-Path $pidFile)) {
  Write-Host 'No test server pid file found. Nothing to stop.'
  exit 0
}

$processId = Get-Content $pidFile
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue

if ($process) {
  Write-Host "Stopping loreserver (pid $processId)..."
  Stop-Process -Id $processId -Force
} else {
  Write-Host "Process $processId is not running."
}

Remove-Item $pidFile -ErrorAction SilentlyContinue

if (Test-Path $dataDirFile) {
  $dataDir = Get-Content $dataDirFile
  if ($dataDir -and (Test-Path $dataDir)) {
    Write-Host "Removing ephemeral data dir $dataDir..."
    Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
  }
  Remove-Item $dataDirFile -ErrorAction SilentlyContinue
}

Write-Host 'Test server stopped.'
