[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.polytrend-local-pids.json'

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host 'No local Poly Trend session is recorded.'
    exit 0
}

$processes = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
foreach ($processId in @($processes.api, $processes.web)) {
    if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $processId -Force
    }
}
Remove-Item -LiteralPath $pidFile -Force
Write-Host 'Stopped the local Poly Trend services.' -ForegroundColor Green
