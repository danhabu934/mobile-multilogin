# Nexo Mobile

Painel de controle para ambientes Android isolados, com front-end na Vercel e worker Android local para Windows ou Linux.

## Executar

```bash
npm install
npm run dev
```

## Arquitetura

- **Control plane:** este painel React/Vite, publicável na Vercel.
- **Android worker:** serviço autenticado executado no computador com virtualização de hardware.
- **Streaming:** WebRTC entre o Android worker e o navegador.
- **Rede:** proxy por dispositivo com kill switch no worker.

O painel não executa Android dentro da Vercel. A criação e inicialização do celular com Play Store acontecem no worker local.

O primeiro Android Worker está em [`worker/`](worker/README.md). Ele possui API autenticada, persistência por perfil, criação de AVD com imagem Google Play, controle de início/parada e verificação dos requisitos KVM.

## Conectar o painel ao worker Windows

Com o worker em execução em `http://127.0.0.1:8787`, abra o painel e clique em **Worker**. No PowerShell, dentro da pasta `worker`, copie o token sem mostrá-lo na tela:

```powershell
$tokenLine = Get-Content .env.windows | Where-Object { $_ -like 'WORKER_API_TOKEN=*' }
$tokenLine.Substring('WORKER_API_TOKEN='.Length) | Set-Clipboard
```

Cole a chave no painel e conecte. O token fica somente na sessão da aba. O worker aceita o domínio de produção e permanece vinculado ao endereço local do computador.

Os commits enviados para a branch `main` publicam automaticamente a versão de produção na Vercel.

As configurações de Azure e Google Cloud permanecem em `infra/` apenas como alternativas futuras.

## Segurança

- Não versionar proxies, senhas, cookies ou tokens.
- Criptografar segredos no backend antes de persistir.
- Usar perfis somente para contas e dispositivos autorizados.
- Não implementar contorno de autenticação, CAPTCHA ou proteções de plataforma.
