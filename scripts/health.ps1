[CmdletBinding()]
param(
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$checks = @(
    @{ Name = 'Research API'; Uri = 'http://localhost:8000/healthz' },
    @{ Name = 'Web terminal'; Uri = 'http://localhost:3000' }
)

foreach ($check in $checks) {
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $check.Uri -UseBasicParsing -TimeoutSec 4
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                $ready = $true
                break
            }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }

    if (-not $ready) {
        throw "$($check.Name) was not ready within $TimeoutSeconds seconds."
    }
    Write-Host "OK  $($check.Name)  $($check.Uri)" -ForegroundColor Green
}

$providerHealth = Invoke-RestMethod -Uri 'http://localhost:8000/api/v1/providers/health' -TimeoutSec 5
Write-Host ("Provider mode: " + ($providerHealth | ConvertTo-Json -Compress))
