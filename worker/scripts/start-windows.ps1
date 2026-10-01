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

if (-not (Test-Path (Join-Path $workerRoot 'dist\server.js'))) { throw 'Worker not compiled. Run setup-windows.ps1 first.' }
$bundledJava = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
if (-not $env:JAVA_HOME -and (Test-Path (Join-Path $bundledJava 'bin\java.exe'))) { $env:JAVA_HOME = $bundledJava }
if ($env:JAVA_HOME) { $env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$env:Path" }
Push-Location $workerRoot
try {
  node .\dist\server.js
  if ($LASTEXITCODE -ne 0) { throw "Worker exited with code $LASTEXITCODE." }
} finally {
  Pop-Location
}

