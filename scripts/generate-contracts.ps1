[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$generatedFile = Join-Path $projectRoot 'packages/contracts/src/generated/openapi.ts'
$before = if (Test-Path -LiteralPath $generatedFile) { Get-Content -Raw -LiteralPath $generatedFile } else { '' }

Push-Location $projectRoot
try {
    npm run contracts:generate
    if ($LASTEXITCODE -ne 0) { throw 'OpenAPI client generation failed.' }
}
finally {
    Pop-Location
}

if ($Check) {
    $after = Get-Content -Raw -LiteralPath $generatedFile
    if ($before -ne $after) {
        throw 'Generated contracts were stale. Run scripts/generate-contracts.ps1 and commit the result.'
    }
    Write-Host 'Generated TypeScript contracts are current.' -ForegroundColor Green
}
