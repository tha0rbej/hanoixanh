$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localNode = Join-Path $PSScriptRoot '.runtime\node'
if (Test-Path -LiteralPath (Join-Path $localNode 'node.exe')) {
    $env:PATH = "$localNode;$env:PATH"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Khong tim thay Node.js. Can Node.js 22.12 tro len.'
}
$env:npm_config_cache = Join-Path $PSScriptRoot '.runtime\npm-cache'
if (-not (Test-Path -LiteralPath 'node_modules\vite\bin\vite.js')) {
    & npx.cmd --yes pnpm@10.34.3 install --frozen-lockfile --store-dir .runtime/pnpm-store
    if ($LASTEXITCODE -ne 0) { throw 'Cai dependencies that bai.' }
}
$localPort = if ($env:PORT) { $env:PORT } else { '8443' }
if ($localPort -notmatch '^\d+$' -or [long]$localPort -lt 1 -or [long]$localPort -gt 65535) {
    throw 'PORT phai la so nguyen tu 1 den 65535.'
}
Write-Host "Khoi dong web tai http://localhost:$localPort - Nhan Ctrl+C de dung."
& node node_modules/vite/bin/vite.js --host 127.0.0.1 --port $localPort --strictPort
exit $LASTEXITCODE
