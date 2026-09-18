$ErrorActionPreference = 'Stop'

$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$required = @(
  (Join-Path $sdkRoot 'emulator\emulator.exe'),
  (Join-Path $sdkRoot 'platform-tools\adb.exe'),
  (Join-Path $sdkRoot 'cmdline-tools\latest\bin\avdmanager.bat')
)

$failures = 0

foreach ($item in $required) {
  if (Test-Path $item) {
    Write-Host "[ok] $item" -ForegroundColor Green
  } else {
    Write-Host "[missing] $item" -ForegroundColor Red
    $failures++
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $major = [int]((node --version).TrimStart('v').Split('.')[0])
  if ($major -ge 22) {
    Write-Host "[ok] Node.js $(node --version)" -ForegroundColor Green
  } else {
    Write-Host "[missing] Node.js 22+ (found $(node --version))" -ForegroundColor Red
    $failures++
  }
} else {
  Write-Host '[missing] Node.js 22+' -ForegroundColor Red
  $failures++
}

$emulator = Join-Path $sdkRoot 'emulator\emulator.exe'
if (Test-Path $emulator) {
  & $emulator -accel-check
  if ($LASTEXITCODE -eq 0) {
    Write-Host '[ok] Android Emulator hardware acceleration' -ForegroundColor Green
  } else {
    Write-Host '[missing] Android Emulator hardware acceleration' -ForegroundColor Red
    $failures++
  }
}

if ($failures -gt 0) {
  Write-Host "Windows host is not ready: $failures requirement(s) missing." -ForegroundColor Red
  exit 1
}

Write-Host 'Windows host is ready for the Android worker.' -ForegroundColor Green

