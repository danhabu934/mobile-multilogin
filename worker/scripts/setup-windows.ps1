param([ValidateSet('emulator','external')][string]$Engine = 'emulator', [switch]$InstallImage)
$ErrorActionPreference = 'Stop'
$workerRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$dataDir = if ($env:WORKER_DATA_DIR) { $env:WORKER_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'NexoMobile' }
$envFile = Join-Path $workerRoot '.env.windows'
function New-RandomHex([int]$length) {
  $bytes = New-Object byte[] $length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 LTS or newer first.' }
if ($InstallImage -and $Engine -eq 'emulator') {
  $sdkmanager = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (-not (Test-Path $sdkmanager)) { throw 'Install Android Studio command-line tools first.' }
  & $sdkmanager --install 'platform-tools' 'emulator' 'system-images;android-35;google_apis_playstore;x86_64'
  if ($LASTEXITCODE -ne 0) { throw "Android image installation failed ($LASTEXITCODE). Accept licenses in Android Studio and retry." }
}
& (Join-Path $workerRoot 'scripts\check-host-windows.ps1') -Engine $Engine
if (-not (Test-Path $envFile)) {
  $freeMb = [math]::Floor((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
  $memoryMb = if ($freeMb -ge 6500) { 4096 } elseif ($freeMb -ge 4500) { 3072 } else { 2048 }
  $cores = [math]::Max(1, [math]::Min(4, [math]::Floor([Environment]::ProcessorCount / 2)))
  $lines = @("WORKER_API_TOKEN=$(New-RandomHex 32)", "WORKER_ENCRYPTION_KEY=$(New-RandomHex 32)", 'WORKER_PORT=8787', 'WORKER_HOST=127.0.0.1', "WORKER_DATA_DIR=$dataDir", "ANDROID_SDK_ROOT=$sdkRoot", "ANDROID_AVD_HOME=$(Join-Path $dataDir 'avd')", 'ANDROID_SYSTEM_IMAGE=system-images;android-35;google_apis_playstore;x86_64', 'ANDROID_DEVICE_ID=pixel_7_pro', 'ANDROID_HEADLESS=false', 'ANDROID_EMULATOR_GPU=auto', "ANDROID_EMULATOR_MEMORY_MB=$memoryMb", "ANDROID_EMULATOR_CORES=$cores", 'ANDROID_EMULATOR_HEAP_MB=512', 'ANDROID_EMULATOR_RESOLUTION=540x960', 'ANDROID_EMULATOR_DENSITY=240', 'ANDROID_MAX_ACTIVE_EMULATORS=1', 'ANDROID_DRY_RUN=false')
  [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
  # Protect generated credentials on Windows using NTFS ACLs, not POSIX mode bits.
  & icacls.exe $envFile /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(F)" 'SYSTEM:(F)' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not protect .env.windows permissions.' }
}
Push-Location $workerRoot
try {
  npm ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed ($LASTEXITCODE). Setup was not completed." }
  npm run verify:runtime
  if ($LASTEXITCODE -ne 0) { throw 'SQLite runtime verification failed. Use supported Node.js and architecture.' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Worker build failed ($LASTEXITCODE). Setup was not completed." }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "Worker tests failed ($LASTEXITCODE). Setup was not completed." }
} finally { Pop-Location }
Write-Host 'Setup verified. Start with: powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1' -ForegroundColor Green
