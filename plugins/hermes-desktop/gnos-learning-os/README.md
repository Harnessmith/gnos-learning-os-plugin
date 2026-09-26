# GNOS Desktop Plugin V1

Interface instalável do GNOS Learning Dashboard para Hermes Desktop. Esta versão implementa navegação, estados visuais e um adapter mock determinístico. Ela não lê arquivos pedagógicos, não executa laboratórios e não depende do profile GNOS.

## Arquitetura

`desktop/plugin.js` contém apenas a camada renderer: páginas, componentes de apresentação e o adaptador `mockGateway`, que representa os contratos em [`contracts.md`](contracts.md). Trocar os mocks no futuro significa implementar o mesmo gateway contra uma API do plugin — sem mudar as páginas.

## Instalação de desenvolvimento

```bash
ln -sfn /home/prompt/Gnos/plugins/hermes-desktop/gnos-learning-os \
  /home/prompt/.hermes/plugins/gnos-learning-os
```

Reinicie/recarregue o Hermes Desktop. Abra **GNOS Learning OS** na barra lateral ou use `⌘K` / `Ctrl+K` e procure **Abrir GNOS Learning OS**.

> O pacote usa exclusivamente contribuições públicas do SDK: `ROUTES_AREA`, `SIDEBAR_NAV_AREA` e `PALETTE_AREA`. Não há alteração do core do Hermes.

## Verificação

```bash
node --check plugins/hermes-desktop/gnos-learning-os/desktop/plugin.js
python3 -m unittest discover -s tests -v
```

O primeiro comando valida a sintaxe do plugin. A suíte Python é a regressão atual do harness GNOS; o teste browser precisa de Chrome instalado no ambiente de execução.
