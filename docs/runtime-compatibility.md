# Motores e compatibilidade do Nexo

O Nexo administra aparelhos Android. Não certifica emuladores como celulares físicos e não promete execução de qualquer app.

| Recurso | Android Emulator | BlueStacks existente | Android físico |
|---|---|---|---|
| Criar novo aparelho/disco | Sim, com imagem instalada | Criar no Multi-instance Manager e conectar no Nexo | Não |
| Iniciar | Sim | Se launcher e nome da instância estiverem configurados | Conectar aparelho já ligado |
| Desligar | Sim, após confirmar a associação ADB | Pelo BlueStacks | No aparelho |
| Tela e toque no painel | Capturas periódicas + comandos ADB | ADB habilitado | USB autorizado |
| Vídeo/áudio fluido | Janela nativa ou scrcpy instalado | Janela do BlueStacks ou scrcpy | scrcpy |
| Instalar APK / abrir apps | Sim, via ADB | Sim, via ADB | Sim, via ADB |
| RAM/GPU/câmera por perfil | Aplicada ao AVD antes do boot | Configurar no BlueStacks | Hardware do aparelho |
| Proxy | HTTP de saída do emulador | Configurar no motor/rede externa | Configurar no aparelho/rede |
| Backup completo | Cópia local com aparelho desligado | Backup do BlueStacks | Recursos do fabricante |

## Windows: atualizar instalação existente

Feche a janela do worker. Execute **na janela do PowerShell**, ajustando o caminho do checkout:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\CAMINHO\mobile-multilogin\worker\scripts\update-windows.ps1" -Start
```

O script exige um checkout sem alterações locais e usa `git pull --ff-only`. Não apaga perfis, `.env.windows` nem discos Android. A atualização não troca a chave de criptografia. Preserve também seu `.env.windows` ao fazer backups externos.

Em instalação nova com SDK instalado:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\CAMINHO\mobile-multilogin\worker\scripts\setup-windows.ps1" -InstallImage
```

Para usar apenas ADB/BlueStacks, passe `-Engine external`. Instale `platform-tools` no SDK Manager. O modo externo não exige a aceleração do Android Emulator.

Dependências do worker são instaladas com `npm ci --ignore-scripts`, seguido por `npm run verify:runtime`, `npm run build` e `npm test`. O pacote SQLite travado no lockfile inclui binários; a verificação abre um banco real antes de declarar sucesso. Não omita essa verificação.

## Conectar BlueStacks

1. Abra a instância que já funciona com seus apps.
2. Em Settings → Advanced, habilite Android Debug Bridge e copie a porta exibida.
3. Conecte o worker ao painel com o token de `.env.windows`.
4. Novo perfil → BlueStacks → informe `127.0.0.1:PORTA` → Conectar ADB local → selecione o dispositivo → Conectar dispositivo.
5. Hardware, versão Android, ABI e câmera são configurados no BlueStacks. Para OBS, selecione OBS Virtual Camera em Settings → Devices.

O botão de iniciar pode lançar uma instância existente se `BLUESTACKS_PLAYER_PATH` apontar para `HD-Player.exe` e o perfil informar o nome interno da instância (por exemplo `Pie64`). Esses parâmetros dependem da instalação. Sem isso, abra a instância pelo próprio BlueStacks. O Nexo não instala nem redistribui o BlueStacks e não cria instâncias automaticamente.

## Vídeo e áudio

A tela no painel é uma prévia por capturas; não é WebRTC nem um player de vídeo. Para vídeo, abra a janela nativa ou instale o scrcpy e configure `SCRCPY_BIN` com o caminho do executável. O botão Abrir espelhamento inicia a janela no computador do worker. Áudio do scrcpy exige Android 11+ e depende do suporte do dispositivo. Um worker remoto sem desktop não pode abrir essa janela; use a prévia ou uma solução própria de acesso remoto ao desktop.

## Backup e segurança

A inicialização usa cold boot por padrão para evitar carregar snapshots antigos após atualizações do SDK. Isso pode aumentar o tempo de boot; `ANDROID_COLD_BOOT_ON_START=false` habilita o comportamento de carregamento de snapshot novamente. Atualizar o SDK não garante que uma imagem possua um patch mais recente: confira a data no diagnóstico do Android.

A aba Backups copia o disco inteiro do AVD e metadados criptografados depois de desligar o aparelho. A cópia é local e contém dados privados; os discos/backups não são criptografados por esta rotina. Use proteção do disco/conta do sistema operacional. Backups podem consumir muitos GB. Restauração é limitada ao mesmo perfil, valida o manifesto e usa diretório temporário antes de substituir o disco.

Os arquivos `.nexo.json` do importador portátil contêm configuração do painel e estado portátil, não discos Android. A antiga fila Chromium continua sendo preparação local; não tem confirmação de execução pelo worker Android. Nenhuma rotina de cookies foi reescrita nesta atualização. Sua rota existente recebe `profileId`, limita o tamanho e confirma o vínculo com o serial.

O teste de proxy valida uma requisição HTTP do worker pelo proxy e exibe seu IP de saída. Não comprova a rota de todos os apps, DNS ou UDP; não há kill switch. O diagnóstico coleta versão, ABI, patch, serviços e estado do boot, sem alegar que estes dados comprovam Play Integrity.

## Validação real dos aplicativos

Para cada versão de app/motor, confira: instalação pela Play Store, abertura, login normal, reprodução prolongada, upload, câmera/microfone, reinício e persistência. Compare o mesmo app e rede no BlueStacks e no Android Emulator. Se houver bloqueio de segurança, guarde versão e mensagem do app e procure seu suporte. Alterar nome/modelo ou desativar ADB não garante certificação.

Os testes automatizados usam simulação ou um processo ADB de teste. Não substituem os testes de InfinitePay, TikTok, câmera OBS ou desempenho no Windows real.

## Testes reproduzíveis

- Worker: `npm ci --ignore-scripts`, `npm run verify:runtime`, `npm test` dentro de `worker`.
- Interface: na raiz, `npm ci`, `npm --prefix worker ci --ignore-scripts`, `npx playwright install chromium`, `npm run test:ui`.
- A suite de interface cria worker/dados temporários e verifica conexão, criação com RAM aplicada, edição, backups/logs e formulário de motor externo. Não usa credenciais pessoais.

## Um comando sem abrir a pasta

Feche a janela antiga do worker. Abra **PowerShell normal** pelo menu Iniciar e cole:

```powershell
$atualizador = Join-Path $env:TEMP 'nexo-update.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/danhabu934/mobile-multilogin/main/worker/scripts/bootstrap-update-windows.ps1' -OutFile $atualizador; powershell -NoProfile -ExecutionPolicy Bypass -File $atualizador
```

O atualizador procura um checkout único em locais comuns (pasta pessoal, Desktop, Documentos, Downloads e `C:\mobile-multilogin`), confirma o repositório/branch e recusa alterações locais. Se o checkout estiver em outro local, execute com `-RepositoryPath "CAMINHO"`. ZIP sem `.git` não é atualizado por este script. Ele não reinicializa Androids nem troca tokens.
