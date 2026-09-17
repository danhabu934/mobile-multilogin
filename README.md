# Nexo Mobile

Painel de controle para ambientes Android isolados, preparado para hospedagem do front-end na Vercel e conexão posterior a workers Linux com KVM.

## Executar

```bash
npm install
npm run dev
```

## Arquitetura

- **Control plane:** este painel React/Vite, publicável na Vercel.
- **Banco e fila:** camada de persistência e comandos a ser conectada ao control plane.
- **Android worker:** serviço separado em host Linux com virtualização KVM.
- **Streaming:** WebRTC entre o Android worker e o navegador.
- **Rede:** proxy por dispositivo com kill switch no worker.

O painel não executa Android dentro da Vercel. Inicialização, Play Store, instalação de APK, snapshots e streaming dependem de um worker compatível.

## Segurança

- Não versionar proxies, senhas, cookies ou tokens.
- Criptografar segredos no backend antes de persistir.
- Usar perfis somente para contas e dispositivos autorizados.
- Não implementar contorno de autenticação, CAPTCHA ou proteções de plataforma.
