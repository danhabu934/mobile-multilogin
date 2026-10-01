param([string]$RepositoryPath = '', [switch]$NoStart)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Instale Git for Windows antes de atualizar.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instale Node.js 22 LTS ou mais recente.' }
if (-not $RepositoryPath) {
  $candidates = [System.Collections.Generic.List[string]]::new()
  foreach ($known in @((Join-Path $env:USERPROFILE 'mobile-multilogin'), 'C:\mobile-multilogin', (Join-Path $env:LOCALAPPDATA 'NexoMobile\app'))) {
    if (Test-Path (Join-Path $known '.git')) { $candidates.Add($known) }
  }
  foreach ($searchRoot in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'), (Join-Path $env:USERPROFILE 'Downloads'))) {
    if ($searchRoot -and (Test-Path $searchRoot)) {
      Get-ChildItem -LiteralPath $searchRoot -Directory -Filter 'mobile-multilogin*' -Recurse -Depth 3 -ErrorAction SilentlyContinue | ForEach-Object {
        if (Test-Path (Join-Path $_.FullName '.git')) { $candidates.Add($_.FullName) }
      }
    }
  }
  $verified = @($candidates | Select-Object -Unique | Where-Object {
    $remote = git -C $_ remote get-url origin 2>$null
    $LASTEXITCODE -eq 0 -and $remote -match 'github\.com[:/]danhabu934/mobile-multilogin(?:\.git)?/?$'
  })
  if ($verified.Count -ne 1) { throw 'Nao encontrei um unico checkout. Execute este script com -RepositoryPath "C:\caminho\mobile-multilogin". Nenhum arquivo foi alterado.' }
  $RepositoryPath = $verified[0]
}
$remote = git -C $RepositoryPath remote get-url origin
if ($LASTEXITCODE -ne 0 -or $remote -notmatch 'github\.com[:/]danhabu934/mobile-multilogin(?:\.git)?/?$') { throw 'A pasta nao pertence ao repositorio esperado.' }
$branch = git -C $RepositoryPath branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Use seu checkout da branch main. O script nao troca branches nem remove alteracoes.' }
$changes = git -C $RepositoryPath status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Ha alteracoes locais. Preserve-as antes de atualizar; nada foi apagado.' }
Write-Host "Atualizando Nexo em $RepositoryPath. Feche a janela antiga do worker antes de continuar." -ForegroundColor Cyan
git -C $RepositoryPath pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'A atualizacao falhou. Nenhum reset foi executado.' }
$script = Join-Path $RepositoryPath 'worker\scripts\update-windows.ps1'
if (-not (Test-Path $script)) { throw 'Script de atualizacao nao encontrado na nova versao.' }
if ($NoStart) { & $script } else { & $script -Start }
