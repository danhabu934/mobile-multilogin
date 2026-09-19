# Nexo Android Worker

Serviço Windows/Linux responsável por criar e executar os Android Virtual Devices. O painel da Vercel não executa Android diretamente; ele envia comandos autenticados para este worker.

## Windows 10/11

Requisitos recomendados para um perfil por vez:

- CPU Intel/AMD com virtualização habilitada na BIOS.
- 16 GB de RAM (feche navegadores e programas pesados antes de iniciar o emulador).
- Node.js 22 ou superior.
- Android Studio com Android SDK, Emulator, Platform Tools e Command-line Tools.
- Imagem Android 14: `system-images;android-34;google_apis_playstore;x86_64`.
- Windows Hypervisor Platform ou Android Emulator Hypervisor Driver funcionando.

No Android Studio, abra **SDK Manager** e instale os componentes e a imagem Google Play acima, aceitando pessoalmente a licença do Android SDK. Depois, no PowerShell aberto dentro da pasta `worker`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-host-windows.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

O setup cria `worker/.env.windows` localmente com tokens aleatórios. Esse arquivo é ignorado pelo Git e não deve ser compartilhado. No Windows o celular abre em uma janela visível; o padrão Linux continua sendo headless.

### Melhor desempenho no computador de 16 GB

- Execute um Android de cada vez. O worker usa `ANDROID_MAX_ACTIVE_EMULATORS=1` por padrão e verifica se há pelo menos 6 GB de RAM disponíveis antes de iniciar um perfil de 4 GB no Windows. Perfis parados continuam salvos com seus aplicativos e dados.
- Feche Android Studio, VMware e outros emuladores durante o uso. Mantenha o worker e o navegador abertos.
- Os ajustes já aplicados são GPU do computador (`ANDROID_EMULATOR_GPU=host`), 4 núcleos, 4 GB de RAM e tela de 720 × 1280. A configuração do AVD só é regravada quando algum valor muda, preservando inicializações rápidas quando possível.
- Em instalações já existentes, atualize o código e execute `npm run build` na pasta `worker`; não precisa rodar o setup nem apagar os perfis. Reinicie o worker após a compilação.
- O desempenho do vídeo também depende da conexão, do aplicativo e do suporte do emulador. As verificações regionais e de login dos aplicativos são independentes da RAM.

## Linux: requisitos do host

- Ubuntu/Debian x86_64 com virtualização aninhada habilitada.
- `/dev/kvm` disponível para o usuário do serviço.
- Node.js 22 ou superior.
- Android command-line tools, Emulator e Platform Tools em `ANDROID_SDK_ROOT`.
- Imagem `system-images;android-34;google_apis_playstore;x86_64` instalada e licença do SDK aceita pelo proprietário do servidor.

Confirme o host:

```bash
bash ./scripts/check-host.sh
```

Instale a imagem após aceitar os termos do Android SDK:

```bash
bash ./scripts/provision-image.sh
```

## Desenvolvimento seguro

```bash
cp .env.example .env
export WORKER_API_TOKEN="$(openssl rand -hex 32)"
export WORKER_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export WORKER_DATA_DIR="$(mktemp -d)"
export ANDROID_DRY_RUN=true
npm install
npm test
npm run dev
```

`ANDROID_DRY_RUN=true` valida a API e a persistência sem iniciar um emulador.

## API inicial

- `GET /health` — verifica KVM e componentes do SDK.
- `GET /v1/profiles` — lista os ambientes.
- `POST /v1/profiles` — cria um AVD persistente.
- `GET /v1/profiles/:id` — consulta o estado.
- `POST /v1/profiles/:id/start` — inicia o Android.
- `POST /v1/profiles/:id/stop` — encerra o Android com segurança.

Todas as rotas `/v1` exigem `Authorization: Bearer <WORKER_API_TOKEN>`.

Os arquivos de perfil, incluindo credenciais de proxy, são criptografados em repouso com AES-256-GCM. Guarde `WORKER_ENCRYPTION_KEY` fora do repositório; perdê-la torna os perfis armazenados irrecuperáveis.

## Limites desta primeira versão

- HTTP/HTTPS usa o proxy nativo do Android Emulator.
- SOCKS5 está modelado, mas só será habilitado com um túnel de rede e kill switch.
- O streaming da tela, instalação assistida de aplicativos e ligação ao painel entram na próxima fase.
- Não há importação ou injeção de tokens de autenticação.
