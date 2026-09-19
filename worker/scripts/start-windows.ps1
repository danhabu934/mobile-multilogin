$ErrorActionPreference = 'Stop'

$workerRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $workerRoot '.env.windows'

if (-not (Test-Path $envFile)) {
  throw 'Run scripts\setup-windows.ps1 first.'
}

$bundledJava = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
if (-not $env:JAVA_HOME -and (Test-Path (Join-Path $bundledJava 'bin\java.exe'))) {
  $env:JAVA_HOME = $bundledJava
}
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
  throw 'Java runtime not found. Confirm the Android Studio installation or configure JAVA_HOME.'
}
$env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$env:Path"

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
