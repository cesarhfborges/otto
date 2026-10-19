<p align="center">
  <img src="build/icon.png" alt="Otto" width="96" />
</p>

<h1 align="center">Otto</h1>

<p align="center">
  Cliente de API <strong>open-source</strong>, <strong>offline-first</strong> e <strong>Git-friendly</strong> para desktop.<br/>
  Inspirado no <a href="https://www.usebruno.com/">Bruno</a>, com a experiência de uso do Postman e do Insomnia.
</p>

---

## Sobre

O **Otto** é um aplicativo desktop para criar, organizar e executar requisições HTTP, voltado para testar e explorar APIs.

A filosofia é a mesma do Bruno:

- **Sem conta e sem nuvem.** Tudo roda localmente, e seus dados ficam na sua máquina.
- **Coleções são pastas no disco.** Cada requisição é um arquivo de texto legível (YAML) que você versiona com Git, revisa em PRs e compartilha com o time pelo próprio repositório.
- **Environments e variáveis.** Use `{{baseUrl}}`, `{{token}}` etc. e troque entre `dev`, `staging` e `prod` com um clique.
- **Requisições executadas fora do navegador.** O Otto faz as chamadas pelo processo nativo (Node.js), sem limitações de CORS.

### Comparativo

|                                   | Otto | Bruno | Postman | Insomnia |
| --------------------------------- | :--: | :---: | :-----: | :------: |
| Open-source                       |  ✅  |  ✅   |   ❌    |    ✅    |
| Funciona 100% offline, sem login  |  ✅  |  ✅   |   ❌    |    ⚠️    |
| Coleções como arquivos no disco   |  ✅  |  ✅   |   ❌    |    ⚠️    |
| Versionamento nativo com Git      |  ✅  |  ✅   |   ⚠️    |    ⚠️    |

## Stack

| Camada     | Tecnologia                                                |
| ---------- | --------------------------------------------------------- |
| Desktop    | [Electron](https://www.electronjs.org/) + TypeScript      |
| Interface  | [Angular 21](https://angular.dev/) (standalone, zoneless) |
| Componentes| [PrimeNG 21](https://primeng.org/) (preset Aura) + Tailwind CSS 4 |
| Empacotamento | [electron-builder](https://www.electron.build/)        |

## Pré-requisitos

- Node.js **22+** (veja `.nvmrc`)
- npm **10+**

## Primeiros passos

```bash
git clone https://github.com/cesarhfborges/otto.git
cd otto
npm install
npm start
```

O `npm start` sobe o `ng serve` (porta 4200), compila o processo main em modo watch e abre o Electron apontando para o servidor de desenvolvimento, com hot reload do Angular.

> Alterações em `electron/` são recompiladas automaticamente, mas exigem reiniciar o Electron (feche o app e rode `npm start` de novo).

## Scripts

| Script                     | Descrição                                                           |
| -------------------------- | ------------------------------------------------------------------- |
| `npm start`                | Alias para `electron:dev`                                           |
| `npm run electron:dev`     | Angular dev server + Electron em modo desenvolvimento               |
| `npm run electron:start`   | Build de produção e abre o Electron com os arquivos estáticos       |
| `npm run electron:compile` | Compila apenas o processo main/preload (`electron/` → `dist/electron`) |
| `npm run electron:watch`   | Compila o processo main/preload em modo watch                       |
| `npm run web:serve`        | Roda só o Angular no navegador (sem APIs do Electron)               |
| `npm run web:build`        | Build só do Angular                                                 |
| `npm run build`            | Limpa `dist/`, faz o build do Angular e compila o Electron          |
| `npm run dist`             | Gera instaladores para a plataforma atual em `release/`             |
| `npm run dist:linux`       | Gera `AppImage` e `.deb`                                            |
| `npm run dist:win`         | Gera instalador `NSIS` (`.exe`)                                     |
| `npm run dist:mac`         | Gera `.dmg`                                                         |
| `npm run typecheck`        | Checagem de tipos do main/preload e do Angular                      |
| `npm test`                 | Testes unitários do Angular (Karma/Jasmine)                         |
| `npm run test:electron`    | Testes unitários do processo main (`node --test`)                   |
| `npm run format`           | Formata o código com Prettier                                       |

> **Dependências:** o Angular já é empacotado em `dist/otto`, então todos os pacotes ficam em `devDependencies` e não entram no instalador. Use `dependencies` apenas para módulos que o processo main (`electron/`) precisa em tempo de execução.

## Estrutura do projeto

```
otto/
├── electron/
│   ├── main/                 # Processo main do Electron (Node.js)
│   │   ├── main.ts           # Ciclo de vida do app, instância única
│   │   ├── container.ts      # Composition root: liga contratos às implementações
│   │   ├── core/contracts/   # Interfaces (executor HTTP, repositórios, stores, importadores, IPC)
│   │   ├── services/         # Regras de negócio (HTTP, importação)
│   │   ├── infra/            # SQLite (conexão, migrações, repositórios)
│   │   ├── ipc/              # Um módulo IPC por responsabilidade + validação de entrada
│   │   └── ui/               # Janela, menu, tray e diálogos nativos
│   ├── preload/preload.ts    # Expõe a API segura `window.otto` ao Angular
│   └── shared/               # Tipos compartilhados: contrato IPC, API e modelos
├── src/                      # Aplicação Angular (renderer)
│   ├── app/core/             # Ports (gateways), adapters Electron, estado (signals) e tema
│   ├── app/shell/            # Layout: barra de título, cabeçalho, abas, status bar
│   ├── app/features/         # Coleções (sidebar e diálogos), workspace, requisição, preferências
│   ├── app/shared/           # Componentes e diretivas reutilizáveis
│   └── types/otto.d.ts       # Tipagem de window.otto
├── docs/                     # Plano de implementação e PROGRESS.md
├── assets/icons/             # Ícones usados em tempo de execução (janela e tray)
├── build/                    # Recursos do electron-builder (icon.png, icon.ico)
└── scripts/run-electron.mjs  # Launcher do Electron usado pelos scripts npm
```

### Arquitetura

```
┌──────────────────────────┐   IPC (contextBridge)   ┌──────────────────────────┐
│  Renderer (Angular)      │ ──── window.otto ─────▶ │  Main (Node.js)          │
│  UI, coleções, editor    │ ◀─── menu:action ────── │  HTTP, arquivos, tray    │
└──────────────────────────┘                         └──────────────────────────┘
```

- O renderer roda com `contextIsolation`, `sandbox` e sem `nodeIntegration`.
- Toda comunicação passa pelo contrato tipado em [`electron/shared/ipc.ts`](electron/shared/ipc.ts).
- O main só aceita IPC vindo do próprio app (dev server ou `file://`).

### Layout

Inspirado no Bruno: janela sem moldura nativa, com barra de título própria (menu da aplicação, home, workspace e minimizar, maximizar e fechar). As coleções ficam na barra lateral, em árvore. À direita ficam o cabeçalho do contexto (workspace ou coleção, com seletor de ambiente e indicador OpenAPI) e as abas, que são agrupadas por contexto e restauradas ao reabrir o app. No rodapé fica a barra de status. No macOS os botões nativos da janela são mantidos.

### Tray e menu

- **Tray:** mostrar/ocultar janela, nova requisição, abrir coleção, opção “manter rodando na bandeja ao fechar” e sair.
- **Menu:** `File` (Nova requisição `Ctrl+N`, Nova coleção `Ctrl+Shift+N`, Abrir coleção `Ctrl+O`, Salvar `Ctrl+S`), `Edit`, `View` (zoom, tela cheia, modo escuro `Ctrl+Shift+D`), `Window` e `Help`.

## Formato das coleções

Uma coleção é uma pasta com um `otto.yaml` na raiz. Cada requisição é um arquivo `.yaml`, e as subpastas servem para agrupar. Arquivos e pastas ocultos (`.git`, `.env`) e `node_modules` são ignorados.

```
minha-api/
├── otto.yaml                 # Manifesto da coleção
├── health-check.yaml
└── users/
    ├── list-users.yaml
    └── create-user.yaml
```

```yaml
# otto.yaml
version: 1
name: Minha API
description: Opcional, em Markdown
```

```yaml
# users/create-user.yaml
name: Create user
method: POST
url: "{{baseUrl}}/users"
seq: 2                        # opcional: ordem dentro da pasta
params:
  - key: dryRun
    value: "true"
    enabled: false            # só aparece quando o item está desativado
headers:
  - key: Content-Type
    value: application/json
auth:
  type: bearer                # none | inherit | bearer | basic | apikey
  token: "{{token}}"
body:
  type: json                  # none | json | text | xml | form-urlencoded
  content: |
    { "name": "Otto", "email": "otto@example.com" }
docs: |
  Documentação da requisição em Markdown.
```

Campos com valor padrão (lista vazia, `auth: none`, `body: none`, sem docs) são omitidos, então os diffs no Git ficam pequenos. Arquivos editados à mão podem omiti-los também. Ambientes, histórico e abas ficam no banco local do app (SQLite), fora da pasta versionada.

## Roadmap

- [x] Estrutura Electron + Angular em TypeScript
- [x] Tray icon e menu da aplicação
- [x] Execução de requisições HTTP no processo main (sem CORS, com cancelamento e timeout)
- [x] Banco local (SQLite), configurações (tema Light/Dark/Auto, timeout, redirects) e coleções em disco (YAML)
- [x] Proxy HTTP/HTTPS com exceções, verificação SSL e CA personalizada (além das CAs do sistema), métricas da resposta e histórico com retenção configurável
- [ ] **MVP:** editor de requisição (método, URL, params, headers, body), visualização da resposta (status, tempo, tamanho, headers, JSON formatado), environments e variáveis
- [ ] Autenticação (Basic, Bearer, API Key), multipart/upload de arquivos, histórico, múltiplas abas, editor com syntax highlight
- [ ] Importar coleções do Postman, Insomnia e OpenAPI; gerar código (cURL, fetch)
- [ ] Scripts pre-request e testes
- [ ] GraphQL, WebSocket, OAuth2 e CLI runner (`otto run`)

## Contribuindo

1. Faça um fork do projeto
2. Crie uma branch: `git checkout -b feat/minha-feature`
3. Faça commit das alterações: `git commit -m "feat: minha feature"`
4. Envie: `git push origin feat/minha-feature`
5. Abra um Pull Request

## Licença

Distribuído sob a licença MIT. Veja [LICENSE.md](LICENSE.md).

Inicialmente baseado no template [Sakai-NG](https://github.com/primefaces/sakai-ng) da PrimeTek.
