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

O primeiro Android Worker está em [`worker/`](worker/README.md). Ele possui API autenticada, persistência por perfil, criação de AVD com imagem Google Play, controle de início/parada e verificação dos requisitos KVM.

O caminho recomendado atual é o Microsoft Azure: consulte [`infra/azure/`](infra/azure/README.md). A configuração usa uma VM D4s v3 com virtualização aninhada, mantém a API do worker ligada somente ao localhost e restringe o SSH ao IP do administrador. A configuração anterior do Google Cloud permanece em [`infra/gcp/`](infra/gcp/README.md) apenas como alternativa.

## Segurança

- Não versionar proxies, senhas, cookies ou tokens.
- Criptografar segredos no backend antes de persistir.
- Usar perfis somente para contas e dispositivos autorizados.
- Não implementar contorno de autenticação, CAPTCHA ou proteções de plataforma.
