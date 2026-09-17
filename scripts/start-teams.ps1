param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $appRoot

try {
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'package.json'))) {
        throw 'package.json was not found in the app folder.'
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js and npm before starting Teams.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot '.env.local'))) {
        throw 'Create .env.local using .env.local.example before starting Teams.'
    }
    if ($CheckOnly) {
        Write-Output 'Teams startup checks passed.'
        exit 0
    }
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules'))) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    Write-Output 'Teams is starting. Open http://localhost:3000 when Ready appears.'
    Write-Output 'Keep this window open while using Teams. Press Ctrl+C to stop.'
    & npm.cmd run dev
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
