# Nexo — camada independente de preparação

Esta entrega é parcial: central web e aplicativo gráfico de diagnóstico somente leitura.
Nenhum arquivo original é alterado. O pacote desktop inclui somente launcher, diagnóstico
e seu manifesto. Não importa, empacota, executa ou consulta o worker original.

## Entregue

- Landing responsiva em português, rotas /download/, /setup/ e /diagnostics/.
- Detecção indicativa de Windows/macOS no navegador; arquitetura do Mac não é inferida.
- Diagnóstico local real: sistema, arquitetura, CPU, RAM, disco, Java, SDK, ADB e aceleração.
- Interface Electron isolada, sem navegação externa nem acesso Node no renderer.
- Configuração NSIS para Windows x64 e DMG separado para Mac ARM64/Intel.
- Scripts de build para o desenvolvedor. O cliente final não executa npm.

## Validação sem dependências

Na pasta distribution, usando Node 22 ou posterior:

```sh
npm run lint
npm test
npm run build
```

O comando lint executa validação de sintaxe com node --check, não ESLint.
O site estático é gerado em dist. Pode ser servido por qualquer servidor estático
com suporte a index.html em subpastas.

## Gerar binários do diagnóstico

Windows x64, com Node/npm para o desenvolvedor:

```powershell
./installer/windows/build.ps1
```

Mac, com Node/npm para o desenvolvedor:

```sh
sh installer/macos/build.sh
```

Artefatos esperados em artifacts:
- NexoDiagnostico-Windows.exe
- NexoDiagnostico-Mac-arm64.dmg
- NexoDiagnostico-Mac-x64.dmg

Estas saídas são do diagnóstico, não instaladores do runtime Nexo.
Os binários não foram gerados nem testados neste ambiente Linux. Antes de distribuir,
é necessário instalar dependências, registrar um package-lock.json, compilar em cada
sistema, assinar com certificados do proprietário e testar instalação limpa.
No Mac, validar também notarização. Não orientar clientes a desativar proteções.
As versões mínimas de Windows/macOS permanecem pendentes dos testes nativos.

## Ainda não entregue

- Download público dos binários, assinatura e notarização.
- Instalação automática de Node, Java, SDK, ADB ou imagem Android.
- Inicialização/conexão com worker, perfis, monitoramento de processos Android,
  ajuste de recursos, recuperação e smoke tests de emulação.
- Checkout e liberação comercial do produto.

Não existe botão de correção automática: nenhum reparo foi implementado.
O site informa indisponibilidade, sem links fictícios ou status simulados.
O diagnóstico apenas classifica hardware de forma indicativa; não estima capacidade
de perfis nem garante compatibilidade de aplicativos. O runtime Node mostrado é
o interno do aplicativo, não uma confirmação de instalação global.

## Testes nativos pendentes

1. Instalar o diagnóstico em Windows e em ambos os Macs.
2. Confirmar interface e medições com ferramentas do sistema.
3. Testar Java/SDK ausentes e presentes, caminhos com espaços e timeout do emulador.
4. Confirmar que o diagnóstico não altera arquivos, configurações ou processos do Nexo.
5. Validar assinatura, instalação, atalho e desinstalação.
