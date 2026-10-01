param([switch]$Start)
$ErrorActionPreference = 'Stop'
$workerRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$repositoryRoot = Split-Path -Parent $workerRoot
Push-Location $repositoryRoot
try {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git for Windows first.' }
  $changes = git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'This folder is not a Git checkout.' }
  if ($changes) { throw 'There are local changes. Preserve them before updating; this script never deletes local code or profiles.' }
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'Update failed. No reset or deletion was performed.' }
  Push-Location $workerRoot
  try {
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    npm run verify:runtime
    if ($LASTEXITCODE -ne 0) { throw 'Runtime verification failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Worker build failed.' }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Worker validation failed.' }
  } finally { Pop-Location }
} finally { Pop-Location }
Write-Host 'Update validated. Tokens, Android disks and cookie routines were preserved.' -ForegroundColor Green
if ($Start) { & (Join-Path $workerRoot 'scripts\start-windows.ps1') }
