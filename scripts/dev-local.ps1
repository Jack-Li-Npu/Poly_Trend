[CmdletBinding()]
param(
    [int]$WebPort = 3000,
    [int]$ApiPort = 8000
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExecutable = Join-Path $projectRoot '.venv\Scripts\python.exe'
$pidFile = Join-Path $projectRoot '.polytrend-local-pids.json'

if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw 'The local Python environment is missing. Create .venv and install services/research[test] first, or use Docker Compose.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    throw 'Node dependencies are missing. Run npm install first.'
}
if (Test-Path -LiteralPath $pidFile) {
    throw 'A local Poly Trend session is already recorded. Run scripts/stop-local.ps1 first.'
}

$api = Start-Process -FilePath $pythonExecutable `
    -ArgumentList @('-m', 'uvicorn', 'polytrend.api:app', '--host', '127.0.0.1', '--port', $ApiPort) `
    -WorkingDirectory (Join-Path $projectRoot 'services\research') `
    -WindowStyle Hidden -PassThru

$npmExecutable = (Get-Command npm.cmd -ErrorAction Stop).Source
$web = Start-Process -FilePath $npmExecutable `
    -ArgumentList @('run', 'dev', '--workspace', '@polytrend/web', '--', '--port', $WebPort) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden -PassThru

@{ api = $api.Id; web = $web.Id } | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding utf8

$deadline = (Get-Date).AddSeconds(45)
do {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/healthz" -TimeoutSec 2
        $page = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort" -TimeoutSec 2 -UseBasicParsing
        if ($health.status -eq 'ok' -and $page.StatusCode -eq 200) { break }
    }
    catch {
        Start-Sleep -Milliseconds 600
    }
} while ((Get-Date) -lt $deadline)

if ((Get-Date) -ge $deadline) {
    throw 'The local services did not become healthy within 45 seconds. Run scripts/stop-local.ps1 and inspect the processes.'
}

Write-Host "Poly Trend V2 is ready: http://localhost:$WebPort" -ForegroundColor Green
Write-Host "API documentation: http://localhost:$ApiPort/docs"
