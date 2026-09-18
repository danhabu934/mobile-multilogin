$ErrorActionPreference = 'Stop'

$workerRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $workerRoot '.env.windows'

if (-not (Test-Path $envFile)) {
  throw 'Run scripts\setup-windows.ps1 first.'
}

foreach ($line in [IO.File]::ReadAllLines($envFile)) {
  if (-not $line -or $line.TrimStart().StartsWith('#')) { continue }
  $parts = $line.Split('=', 2)
  if ($parts.Count -eq 2) {
    [Environment]::SetEnvironmentVariable($parts[0], $parts[1], 'Process')
  }
}

Push-Location $workerRoot
try {
  node .\dist\server.js
} finally {
  Pop-Location
}

