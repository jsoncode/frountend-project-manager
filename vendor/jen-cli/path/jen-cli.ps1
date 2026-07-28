$ErrorActionPreference = 'Stop'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  [Console]::Error.WriteLine('[jen-cli] Node.js is not installed or not on PATH. Install Node.js 18+.')
  exit 1
}
$script = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\bin\jen-cli.mjs'))
& node $script @args
exit $LASTEXITCODE
