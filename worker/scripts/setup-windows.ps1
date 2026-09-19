$ErrorActionPreference = 'Stop'

$workerRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$dataDir = Join-Path $env:LOCALAPPDATA 'NexoMobile'
$envFile = Join-Path $workerRoot '.env.windows'

& (Join-Path $workerRoot 'scripts\check-host-windows.ps1')

function New-RandomHex([int]$length) {
  $bytes = New-Object byte[] $length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

if (-not (Test-Path $envFile)) {
  $lines = @(
    "WORKER_API_TOKEN=$(New-RandomHex 32)",
    "WORKER_ENCRYPTION_KEY=$(New-RandomHex 32)",
    'WORKER_PORT=8787',
    'WORKER_HOST=127.0.0.1',
    "WORKER_DATA_DIR=$dataDir",
    "ANDROID_SDK_ROOT=$sdkRoot",
    "ANDROID_AVD_HOME=$(Join-Path $dataDir 'avd')",
    'ANDROID_SYSTEM_IMAGE=system-images;android-35;google_apis_playstore;x86_64',
    'ANDROID_DEVICE_ID=pixel_7_pro',
    'ANDROID_HEADLESS=false',
    'ANDROID_EMULATOR_GPU=host',
    'ANDROID_EMULATOR_MEMORY_MB=4096',
    'ANDROID_EMULATOR_CORES=4',
    'ANDROID_EMULATOR_HEAP_MB=512',
    'ANDROID_EMULATOR_RESOLUTION=540x960',
    'ANDROID_EMULATOR_DENSITY=240',
    'ANDROID_MAX_ACTIVE_EMULATORS=1',
    'ANDROID_DRY_RUN=false'
  )
  [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
  Write-Host "Created $envFile" -ForegroundColor Green
}

Push-Location $workerRoot
try {
  npm ci
  npm run build
} finally {
  Pop-Location
}

Write-Host 'Setup complete. Start with: powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1' -ForegroundColor Green
