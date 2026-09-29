param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodePath = $null
$systemNode = Get-Command node -ErrorAction SilentlyContinue
foreach ($candidate in @($systemNode.Source, $bundledNode)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
        $versionText = & $candidate --version
        if ([version]$versionText.TrimStart('v') -ge [version]'22.13.0') { $nodePath = $candidate; break }
    }
}
if (-not $nodePath) { throw 'Install Node.js 24 LTS, then double-click this launcher again.' }
$env:PATH = (Split-Path $nodePath -Parent) + ';' + $env:PATH
if (-not (Test-Path -LiteralPath 'node_modules')) {
    Write-Host 'Installing dependencies for the first launch...'
    $npmCommand = Get-Command npm.cmd -ErrorAction Stop
    $npmCli = Join-Path (Split-Path $npmCommand.Source -Parent) 'node_modules\npm\bin\npm-cli.js'
    & $nodePath $npmCli install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection and try again.' }
}
Write-Host 'Preparing Party Tracker...'
& $nodePath 'node_modules/typescript/bin/tsc' -b
if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed.' }
& $nodePath 'node_modules/vite/bin/vite.js' build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
$launchUrl = 'http://localhost:4310'
try {
    $existing = Invoke-WebRequest -Uri "$launchUrl/api/state" -UseBasicParsing -TimeoutSec 2
    if ($existing.StatusCode -eq 200) { if (-not $NoBrowser) { Start-Process $launchUrl }; exit 0 }
} catch { }
if ($NoBrowser) { & $nodePath 'server/index.mjs' } else { & $nodePath 'server/index.mjs' --open }
exit $LASTEXITCODE
