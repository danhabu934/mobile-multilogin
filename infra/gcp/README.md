# Google Cloud Android worker

Esta configuração cria uma VM Ubuntu 24.04 preparada para o Nexo Android Worker.

## O que ela cria

- `n2-standard-4` (4 vCPU, 16 GB RAM), compatível com virtualização aninhada.
- Disco balanceado de 80 GB.
- Virtualização aninhada para expor `/dev/kvm` dentro da VM.
- SSH somente pelo Google IAP.
- Worker ligado apenas a `127.0.0.1:8787`; a API não fica pública.
- Bootstrap do Node.js e do worker em `ANDROID_DRY_RUN=true`.

O Android SDK/Play Store não é instalado automaticamente porque o proprietário da conta precisa aceitar pessoalmente a licença do Android SDK. Depois da criação, conecte-se à VM, confira os termos oficiais e execute `worker/scripts/provision-image.sh` após instalar as command-line tools.

## Aplicar

1. Ative o trial e crie/selecione um projeto no Google Cloud.
2. Ative as APIs Compute Engine e IAP.
3. Instale e autentique `gcloud` e Terraform na sua máquina.
4. Execute:

```bash
cd infra/gcp
cp terraform.tfvars.example terraform.tfvars
# Troque project_id no arquivo terraform.tfvars.
gcloud auth application-default login
terraform init
terraform plan
terraform apply
```

`terraform apply` cria uma VM faturável e deve ser confirmado apenas depois de revisar o plano e o custo exibido no Google Cloud.

## Verificar

Use os comandos impressos nos outputs do Terraform. Dentro da VM:

```bash
sudo cat /var/lib/nexo-mobile/bootstrap-status.txt
sudo systemctl status nexo-android-worker --no-pager
sudo cat /root/nexo-worker-credentials.txt
curl http://127.0.0.1:8787/health
```

O worker começa em modo de simulação. Só altere `ANDROID_DRY_RUN=false` depois que `/dev/kvm`, Emulator, Platform Tools e a imagem Google Play estiverem instalados e o script `worker/scripts/check-host.sh` passar.

## Evitar cobrança inesperada

- Pare a VM quando não estiver usando.
- Crie um orçamento e alertas de cobrança antes de iniciar os emuladores.
- Um único `n2-standard-4` pode consumir o crédito do trial; ele não faz parte do nível Always Free.
- Não troque para `e2-micro`: E2 não oferece virtualização aninhada e o Android Emulator não terá aceleração KVM.

