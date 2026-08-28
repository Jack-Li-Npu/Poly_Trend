[CmdletBinding()]
param(
    [switch]$NoBuild,
    [switch]$Detached = $true
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot '.env'
$environmentTemplate = Join-Path $projectRoot '.env.example'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop is required. Install it, start it, and run this script again.'
}

docker compose version | Out-Null

if (-not (Test-Path -LiteralPath $environmentFile)) {
    Copy-Item -LiteralPath $environmentTemplate -Destination $environmentFile
    Write-Host 'Created .env from .env.example. Provider keys are optional for the seeded mode.' -ForegroundColor Yellow
}

Push-Location $projectRoot
try {
    $composeArguments = @('compose', 'up')
    if ($Detached) { $composeArguments += '--detach' }
    if (-not $NoBuild) { $composeArguments += '--build' }
    & docker @composeArguments
    if ($LASTEXITCODE -ne 0) { throw 'The Poly Trend stack did not start successfully.' }

    Write-Host ''
    Write-Host 'Poly Trend V2 is starting:' -ForegroundColor Green
    Write-Host '  Product  http://localhost:3000'
    Write-Host '  API docs http://localhost:8000/docs'
    Write-Host '  Health   http://localhost:8000/healthz'
    Write-Host ''
    Write-Host 'Run scripts/health.ps1 to wait for every service to become ready.'
}
finally {
    Pop-Location
}
