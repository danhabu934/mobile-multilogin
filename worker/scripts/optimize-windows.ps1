$ErrorActionPreference = 'Stop'

$workerRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $workerRoot '.env.windows'
if (-not (Test-Path $envFile)) {
  throw 'Arquivo .env.windows ausente. Execute scripts\setup-windows.ps1 primeiro.'
}

$settings = [ordered]@{
  ANDROID_EMULATOR_GPU = 'host'
  ANDROID_EMULATOR_MEMORY_MB = '4096'
  ANDROID_EMULATOR_CORES = '4'
  ANDROID_EMULATOR_RESOLUTION = '540x960'
  ANDROID_EMULATOR_DENSITY = '240'
  ANDROID_MAX_ACTIVE_EMULATORS = '1'
}

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [IO.File]::ReadAllLines($envFile)) {
  $name = $line.Split('=', 2)[0].Trim()
  if ($settings.Contains($name)) {
    $lines.Add("$name=$($settings[$name])")
    $settings.Remove($name)
  } else {
    $lines.Add($line)
  }
}
foreach ($name in $settings.Keys) {
  $lines.Add("$name=$($settings[$name])")
}

[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
Write-Host 'Modo de desempenho aplicado. Desligue o Android e reinicie o worker para aplicar as mudanças.' -ForegroundColor Green
