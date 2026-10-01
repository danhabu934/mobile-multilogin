$ErrorActionPreference = 'Stop'

$workerRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $workerRoot '.env.windows'
if (-not (Test-Path $envFile)) {
  throw 'Arquivo .env.windows ausente. Execute scripts\setup-windows.ps1 primeiro.'
}

$freeMb = [math]::Floor((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
$memoryMb = if ($freeMb -ge 6500) { '4096' } elseif ($freeMb -ge 4500) { '3072' } else { '2048' }
$cores = [math]::Max(1, [math]::Min(4, [math]::Floor([Environment]::ProcessorCount / 2)))
$settings = [ordered]@{
  ANDROID_EMULATOR_GPU = 'auto'
  ANDROID_EMULATOR_MEMORY_MB = $memoryMb
  ANDROID_EMULATOR_CORES = [string]$cores
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
Write-Host 'Padrão para novos perfis atualizado. Edite a RAM dos perfis existentes na aba Configuração. Desligue o Android e reinicie o worker para aplicar as mudanças.' -ForegroundColor Green

