$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Execute em Windows x64.' }
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências de build.' }
  npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'Falha na validação de sintaxe.' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes.' }
  npm run package:windows
  if ($LASTEXITCODE -ne 0) { throw 'Falha no empacotamento.' }
} finally { Pop-Location }
