[CmdletBinding()]
param(
    [switch]$RemoveVolumes
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop is required to stop the local stack.'
}

Push-Location $projectRoot
try {
    $composeArguments = @('compose', 'down', '--remove-orphans')
    if ($RemoveVolumes) {
        $composeArguments += '--volumes'
        Write-Warning 'PostgreSQL, Redis, and local research volumes will be removed.'
    }
    & docker @composeArguments
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not stop the stack.' }
}
finally {
    Pop-Location
}
