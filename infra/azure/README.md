# Azure Android worker

Esta configuração cria o Nexo Android Worker no Microsoft Azure usando uma VM compatível com virtualização aninhada.

## Configuração padrão

- Região: `East US`.
- VM: `Standard_D4s_v3` com 4 vCPU e 16 GB de RAM.
- Ubuntu Server 22.04 LTS Gen2.
- Disco Standard SSD de 80 GB.
- SSH limitado ao IP informado em `admin_cidr`.
- Nenhuma porta pública para a API; o worker escuta somente em `127.0.0.1:8787`.
- Worker inicialmente em `ANDROID_DRY_RUN=true`.

A VM gratuita B1s não serve para este projeto: ela é pequena demais e não fornece o ambiente necessário para executar o Android Emulator acelerado. A VM D4s v3 será paga com o crédito do trial enquanto houver saldo.

## Antes de aplicar

1. Ative a conta gratuita do Azure.
2. Copie o **Subscription ID** no portal.
3. Instale o Azure CLI e Terraform.
4. Crie uma chave SSH, se ainda não tiver:

```bash
ssh-keygen -t ed25519 -C "nexo-azure"
```

5. Descubra seu IP público e acrescente `/32`.

## Aplicar

```bash
cd infra/azure
cp terraform.tfvars.example terraform.tfvars
# Edite subscription_id, admin_cidr e admin_ssh_public_key.
az login
terraform init
terraform plan
terraform apply
```

`terraform apply` cria recursos que consomem o crédito do trial. Revise o plano antes de confirmar.

## Verificar

O Terraform imprime o comando SSH. Dentro da VM:

```bash
sudo cat /var/lib/nexo-mobile/bootstrap-status.txt
sudo systemctl status nexo-android-worker --no-pager
sudo cat /root/nexo-worker-credentials.txt
curl http://127.0.0.1:8787/health
```

O Android SDK e a imagem Google Play continuam dependendo da aceitação da licença do Android SDK pelo titular da conta. Só mude `ANDROID_DRY_RUN=false` após instalar o SDK e executar `worker/scripts/check-host.sh` com sucesso.

## Controle de gastos

- Crie um orçamento e alertas antes de ligar os emuladores.
- Desligue a VM quando não estiver usando.
- Não converta a assinatura para pagamento conforme o uso sem revisar os custos.
- O crédito do trial dura até 30 dias ou até ser consumido, o que acontecer primeiro.

