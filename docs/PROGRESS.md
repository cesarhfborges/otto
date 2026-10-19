# Otto — Progresso da Implementação

> Fonte da verdade sobre o estado atual do software. Atualizado a cada entrega.
> Plano original: [PLANO_IMPLEMENTACAO.md](PLANO_IMPLEMENTACAO.md).

**Última atualização:** 2026-10-19 — Pasta base de workspaces, entrada só por importação e cadastro de ambientes; próxima: Etapa 7.

## Visão geral

| Etapa | Descrição                                              | Status          |
| ----- | ------------------------------------------------------ | --------------- |
| 1     | Setup do boilerplate e estrutura SOLID                 | ✅ Concluída    |
| 2     | Banco de dados embutido (SQLite)                       | ✅ Concluída    |
| 3     | Configuração geral do sistema e temas                  | ✅ Concluída    |
| 4     | Ponte IPC e sistema de arquivos (local-first)          | ✅ Concluída    |
| 5     | Motor de requisições HTTP + histórico/métricas         | ✅ Concluída    |
| 6     | Interface Angular (layout base e abas)                 | ✅ Concluída (adiantada, antes da 5) |
| 7     | Editor de requisição, resposta e interpolação          | ⏳ Próxima — 🟡 Parcial (requisição em modo leitura, mas já envia; painel de resposta básico) |
| 8     | Collections (estilo Bruno), importação e sync OpenAPI  | 🟡 Parcial (só contratos + registry) |

## Stack efetiva

| Item          | Versão                         | Observação |
| ------------- | ------------------------------ | ---------- |
| Node.js (dev) | 22.23 (`.nvmrc` = 22, `engines >= 22.12`) | Tooling, build e testes do main. |
| Electron      | 44.9.0                         | Embute **Node 24.22** / Chromium 152 em runtime. |
| Angular       | 21.0.x (standalone, zoneless, signals) | `@Service` (v22) ainda não disponível → `@Injectable`. |
| UI            | PrimeNG 21 (preset `OttoPreset` = Aura + contraste AA + densidade) + Tailwind 4 | Template Sakai-NG **removido** na Etapa 6. |
| TypeScript    | 5.9                            | `strict` em ambos os projetos. |
| SQLite        | `node:sqlite` (SQLite 3.53)    | Validado dentro do Electron 44; sem módulo nativo. |
| YAML          | `yaml` 2.9 (dependência de runtime) | Formato das coleções em disco. JS puro, sem dependências; confirmado dentro do `app.asar`. |
| ZIP           | `fflate` 0.8.2 (dependência de runtime, versão fixa) | Exportar/importar workspaces. JS puro, sem dependências. |
| HTTP          | `undici` 7.30 (dependência de runtime, versão fixa) | `fetch` + `Agent`/`EnvHttpProxyAgent` próprios (proxy, exceções, CAs). JS puro; confirmado dentro do `app.asar`. |

## Arquitetura de pastas

```
otto/
├── electron/
│   ├── tsconfig.json             # Compila main + preload + shared → dist/electron
│   ├── main/                     # Processo main (Node)
│   │   ├── main.ts               # Entry: ciclo de vida, instância única, bootstrap
│   │   ├── container.ts          # Composition root (único lugar com classes concretas)
│   │   ├── config.ts             # Constantes e caminhos
│   │   ├── core/contracts/       # Interfaces (DIP/ISP)
│   │   │   ├── http-executor.ts        IHttpExecutor
│   │   │   ├── settings-store.ts       ISettingsStore, ISettingsService, IWindowStateStore
│   │   │   ├── renderer-notifier.ts    IRendererNotifier (eventos main → renderer)
│   │   │   ├── repository.ts           IReadRepository, IWriteRepository, IRepository
│   │   │   ├── repositories.ts         IHistoryRepository, ITabRepository, IEnvironmentRepository, ICollectionMetadataRepository
│   │   │   ├── collection-store.ts     ICollectionStore, ICollectionFormat, ICollectionWatcher, ITrash
│   │   │   ├── collection-importer.ts  ICollectionImporter + modelos de importação
│   │   │   ├── database.ts             Migration, IMigrationRunner
│   │   │   ├── system.ts               IClock, IIdGenerator
│   │   │   └── ipc-module.ts           IIpcModule, IIpcRegistrar, IpcHandler
│   │   ├── core/validation/      # unknown → tipos do contrato (guards + um arquivo por agregado)
│   │   │   ├── request.ts        # RequestDefinition, caminhos relativos e nomes de entrada
│   │   │   └── settings.ts       # SETTING_LEAVES: esquema das preferências (parse de patch e leitura do banco)
│   │   ├── services/
│   │   │   ├── http/fetch-http-executor.ts   # fetch do undici: timeout, cancelamento, métricas, limite de tamanho
│   │   │   ├── http/dispatcher-provider.ts   # Agent/EnvHttpProxyAgent conforme proxy e SSL (cacheado)
│   │   │   ├── http/history-recording-executor.ts  # Decorator: grava histórico + retenção
│   │   │   ├── collections/collection.service.ts  # Disco ↔ banco: abrir/criar, árvore, CRUD de arquivos, watcher
│   │   │   ├── collections/slug.ts           # Nomes de arquivo seguros
│   │   │   ├── import/importer-registry.ts   # Registro de importadores (OCP)
│   │   │   └── settings/settings.service.ts  # Decorator do store: cache + evento de mudança
│   │   ├── infra/
│   │   │   ├── collections/      # FsCollectionStore, safe-path (confinamento), YamlCollectionFormat, FsCollectionWatcher
│   │   │   ├── database/         # openDatabase, transaction, MigrationRunner, migrations/NNN-*.ts
│   │   │   ├── repositories/     # Sqlite*Repository / SqliteSettingsStore
│   │   │   ├── settings/legacy-settings-import.ts  # settings.json → SQLite (uma vez)
│   │   │   └── system/           # systemClock, uuidGenerator, electronTrash
│   │   ├── ipc/                  # Um módulo IPC por responsabilidade
│   │   │   ├── handle.ts         # ElectronIpcRegistrar (rejeita sender não confiável)
│   │   │   ├── app.ipc.ts, settings.ipc.ts, theme.ipc.ts, http.ipc.ts
│   │   │   └── history.ipc.ts, tabs.ipc.ts, environments.ipc.ts, collections.ipc.ts, collection-files.ipc.ts
│   │   └── ui/                   # Integração nativa
│   │       ├── window.ts         # WindowManager (também IRendererNotifier)
│   │       ├── theme.ts          # ThemeController (nativeTheme ↔ preferência)
│   │       ├── tray.ts           # TrayManager
│   │       ├── menu.ts           # buildAppMenu(commands)
│   │       ├── commands.ts       # AppCommands (compartilhado por menu e tray)
│   │       └── dialogs.ts        # DialogService
│   │   └── testing/              # fixtures.ts (fakeClock, sequentialIds, migratedMemoryDb) e tls.ts (certificado de teste); fora do instalador
│   ├── preload/preload.ts        # contextBridge → window.otto (só `import type` locais)
│   └── shared/                   # Tipos compartilhados main ↔ preload ↔ renderer
│       ├── ipc.ts                # IpcInvokeContract (canal → args/result), IpcEventContract
│       ├── api.ts                # OttoApi segregada: AppApi, SettingsApi, HttpApi, DialogApi, EventsApi
│       ├── http/build-request.ts # RequestDefinition → HttpRequest (params, headers, auth, corpo); usado pelo renderer
│       └── models/               # Entidades: http, request, settings, history, tab, environment, collection, app, common
└── src/                          # Renderer (Angular)
    ├── types/otto.d.ts           # window.otto
    └── app/
        ├── shell/                        # Layout: shell, title-bar, context-header, tab-strip, tab-host, status-bar, confirm-host
        ├── features/collections/         # Sidebar (p-tree), nós da árvore, diálogos New Collection/Request/Folder
        ├── features/workspace/           # Abas Overview e Environments do workspace
        ├── features/collection/          # Overview da coleção (cartões + documentação)
        ├── features/request/             # Aba de requisição (URL, sub-abas, painel de resposta)
        ├── shared/                       # MethodBadge, ícones de aba, diretiva TreeToggleLabel
    └── app/core/
        ├── bridge/otto-api.token.ts      # InjectionToken OTTO_API + BridgeUnavailableError
        ├── ports/index.ts                # Classes abstratas (tokens de DI): *Gateway
        ├── adapters/electron/electron-gateways.ts  # Implementações sobre IPC
        ├── state/settings.state.ts       # SettingsState (signals; fonte da verdade no main)
        ├── state/collections.state.ts    # CollectionsState (abertas/recentes; recarrega ao mudar no disco)
        ├── theme/theme.service.ts        # ThemeService (preferência × tema efetivo, classe .app-dark)
        ├── theme/otto-preset.ts          # Aura + contraste AA (primary.700 no claro) + densidade
        ├── state/tabs.state.ts           # Abas por contexto (workspace/coleção), persistidas
        ├── state/{ui,window-controls,environments,confirm}.state.ts
        └── providers.ts                  # provideOttoCore() (+ inicializa o ThemeService)
    └── app/features/settings/            # Preferences (aba com navegação vertical)
```

Alias TypeScript no Angular: `@shared/*` → `electron/shared/*`.

## Decisões técnicas

1. **Reaproveitamento do boilerplate existente.** O projeto já tinha Electron + Angular (Sakai-NG), tray, menu e executor HTTP funcionando. A Etapa 1 reorganizou esse código em vez de recriá-lo.
2. **SQLite via `node:sqlite`** em vez de `better-sqlite3`: disponível no runtime do Electron 44 (Node 24), sem rebuild nativo nem `electron-rebuild`, empacotamento trivial. API síncrona → contratos de repositório síncronos.
3. **Contrato IPC tipado por canal** (`IpcInvokeContract`): `invoke` no preload e `handle` no main são checados pelo compilador. Argumentos chegam ao main como `unknown` e passam por `ipc/validators.ts`.
4. **Preload em sandbox** (`sandbox: true`): só pode importar `electron` em runtime; imports locais precisam ser `import type`. Verificado no JS compilado.
5. **Composition root manual** (`container.ts`) no main, sem biblioteca de DI. Módulos IPC implementam `IIpcModule` e são registrados em lote.
6. **Ports/adapters no Angular**: componentes dependem de `HttpGateway`, `SettingsGateway` etc. (classes abstratas); `provideOttoCore()` liga às implementações Electron. Permite fakes em testes e um adapter "web" futuro.
7. **Histórico/métricas (Etapa 5)** serão adicionados por *decorator* sobre `IHttpExecutor` (ex.: `HistoryRecordingExecutor`), sem tocar no `FetchHttpExecutor`.
8. **Validação centralizada em `core/validation`**: usada pelo IPC e pela infra (importação legada), evitando dependência `infra → ipc`. Erros saem como `ValidationError` com o campo (`Invalid "tabs[0].kind": ...`).
9. **Banco em `userData/otto.db`** com `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Fechado em `will-quit`. Falha ao abrir/migrar mostra `dialog.showErrorBox` e encerra o app.
10. **Migrações versionadas** em `schema_migrations`, cada uma em transação própria. Banco com versão maior que a conhecida pelo app é recusado (proteção contra downgrade). Migrações publicadas nunca são editadas.
11. **Settings em tabela chave/valor, uma linha por folha** (`theme`, `http.proxy.url`...) com valor JSON, descrita por `SETTING_LEAVES`. O mesmo esquema valida patches do renderer (inválido → `ValidationError`; desconhecido → ignorado) e lê o banco (inválido → padrão). Novas preferências não exigem migração. Estado da janela usa a chave interna `window.bounds`.
12. **Integridade referencial**: excluir coleção apaga seus ambientes (`CASCADE`) e preserva o histórico (`SET NULL`). Caminho de coleção é único e normalizado (precisa ser absoluto).
13. **`node:sqlite` não aceita `boolean` nem `undefined`** como parâmetro: helpers `toSqlBool`/`toSqlNullable`/`toSqlJson` em `infra/database/sqlite.ts`.
14. **Tema**: a preferência (`light`/`dark`/`auto`) vive nas settings; o main aplica em `nativeTheme.themeSource` (afeta menus/diálogos nativos e `prefers-color-scheme`) e emite `theme:changed`. No renderer, `ThemeService` é a fonte única (classe `.app-dark`). Para evitar flash branco no escuro, a janela nasce com `backgroundColor` do tema e o preload aplica `.app-dark` no `DOMContentLoaded` (via `additionalArguments`).
15. **Eventos main → renderer** via `IRendererNotifier` (`settings:changed`, `theme:changed`): mudanças feitas pelo tray aparecem na tela de configurações. Durante o carregamento da página eventos são descartados; o Angular busca o estado ao iniciar.
16. **Formulário de configurações com auto-save**: reactive forms; toggles/seletores salvam na hora e campos de texto ao sair do campo (`updateOn: 'blur'`). O main é a fonte da verdade: o valor salvo (validado) volta para o formulário.
17. **Sem recursos externos no renderer**: removidos a fonte do `fonts.cdnfonts.com` e o `preconnect` para `primefaces.org` (violavam a premissa offline/sem telemetria); usa pilha de fontes do sistema.
18. **Contraste AA**: o preset Aura tem 4,34:1 nas opções não selecionadas do `SelectButton`; os ajustes de contraste ficam no `OttoPreset` (`core/theme/otto-preset.ts`).
19. **Formato em disco**: `otto.yaml` (manifesto com `version`) + uma requisição por `.yaml`; pastas agrupam. Serialização com ordem fixa de chaves, padrões omitidos e textos multilinha em bloco (`|`), pensando em diffs de Git. O parser é tolerante a campos omitidos e método em minúsculas, mas rejeita YAML inválido, chaves duplicadas e excesso de aliases ("billion laughs"). Manifesto de versão mais nova é recusado. Ambientes/histórico/abas ficam no SQLite (conforme o plano), não na pasta versionada.
20. **Confinamento de caminhos** (`safe-path.ts`): toda E/S usa caminhos relativos com `/`; rejeita absolutos, `..`, `\`, NUL e entradas ocultas (protege `.git`/`.env`), e verifica via `realpath` que symlinks não levam para fora da raiz. A listagem ignora symlinks (evita loops). Limites: profundidade 32, 10 mil entradas.
21. **Escrita atômica** (temporário `wx` + `rename`) e **exclusão pela lixeira do sistema** (`shell.trashItem`, recuperável). `move` não sobrescreve (exceto renomear só maiúsculas/minúsculas do mesmo inode).
22. **Separação de responsabilidades em coleções**: `ICollectionStore` (E/S confinada), `ICollectionFormat` (YAML; outro formato como `.bru` seria outra implementação), `ICollectionWatcher` (`fs.watch` recursivo com debounce, ignorando `.git` e temporários) e `CollectionService` (orquestra e mapeia para `collections_metadata` pelo caminho). O manifesto `otto.yaml` não pode ser movido/removido pelo app.
23. **Arquivos inválidos aparecem na árvore** com `method: null` e `error`, para o usuário corrigir em vez de sumirem.
24. **Layout estilo Bruno (Etapa 6, adiantada a pedido)**: janela **sem moldura** (`frame: false`; no macOS `titleBarStyle: 'hiddenInset'` com os botões nativos) e barra de título própria com regiões `-webkit-app-region`. O botão de menu abre o **menu nativo** como popup (`Menu.popup`), reaproveitando itens e atalhos de `menu.ts`. Controles da janela via `window:*` + evento `window:state-changed`.
25. **Abas por contexto**: cada aba pertence ao workspace (`collectionId = null`) ou a uma coleção; a faixa mostra só as do contexto atual e cada contexto lembra a última aba ativa (como no Bruno). Persistidas na tabela `tabs` (migração `002` adiciona `collection_id` com `ON DELETE CASCADE`) com debounce de 300 ms; coleções abertas ficam marcadas em `collections_metadata.is_open` e são reabertas ao iniciar, antes das abas. Encerrar o app não "fecha" coleções; fechar pela UI sim.
26. **Sem router**: a navegação é por abas; o conteúdo de cada tipo de aba é carregado com `@defer` (chunks separados: preferences, request-view, overviews). O orçamento de bundle inicial passou a avisar em 1,5 MB (app desktop, carregado do disco; hoje ~1,01 MB, contra 1,76 MB com o Sakai).
27. **Contornos de acessibilidade no PrimeNG 21** (todos validados com axe): `ConfirmDialog` deixa `role="alertdialog"` sem nome no DOM mesmo fechado → `ConfirmState` + `ConfirmHost` sobre `p-dialog`; `Splitter` gera `role=separator` sem `aria-valuenow` → grid CSS; `Tree` não aplica `togglerAriaLabel` e o `pt` só vale no 1º nível → diretiva `TreeToggleLabel` (MutationObserver); cor primária emerald-500 tem 2,53:1 em texto no tema claro → `primary.700`.
28. **Faixa de abas acessível**: padrão WAI-ARIA tabs com foco itinerante (setas/Home/End), `Delete` e `Ctrl+W` fecham, `Ctrl+Tab` alterna, clique do meio fecha; o "×" é atalho de mouse fora da ordem de tabulação (evita controle aninhado em `role=tab`).
29. **Testes do main** com `node --test` sobre o JS compilado (`npm run test:electron`). Código testado não pode importar `electron`. Arquivos `*.test.js` são excluídos do instalador.
30. **Motor HTTP com `undici` explícito** (não o `fetch` global): só assim dá para passar um `dispatcher` próprio. `DispatcherProvider` mantém um único pool de conexões enquanto proxy/SSL não mudam (a chave inclui o `mtime` do arquivo de CA); ao mudar, o anterior fecha depois que suas requisições terminam.
31. **Proxy** via `EnvHttpProxyAgent` com `httpProxy`/`httpsProxy`/`noProxy` passados explicitamente (nunca lê `HTTP_PROXY`/`NO_PROXY` do ambiente). Exceções aceitam `host`, `.dominio`, `*.dominio` e `host:porta`. HTTP passa pelo proxy com URI absoluta (`proxyTunnel: false`); HTTPS usa túnel `CONNECT`. Credenciais podem ir na URL do proxy (`http://user:pass@proxy:3128`).
32. **Certificados**: o Otto confia nas CAs embutidas no Node **e nas do sistema operacional** (`tls.getCACertificates('system')`), para funcionar atrás de proxies corporativos sem configuração. A CA personalizada é somada a essas (a opção `ca` do Node substitui a lista; por isso a soma). Arquivo ausente ou que não seja PEM vira erro claro na resposta; erros de certificado incluem a dica de onde ajustar.
33. **Resposta**: corpo lido em streaming e cortado em 50 MB (`MAX_RESPONSE_BYTES`, `truncated: true`); texto decodificado pelo `charset`; conteúdo binário (imagens, PDF) vai em base64 (`bodyEncoding`). Métricas: TTFB (inclui DNS/conexão/TLS/proxy, que o `fetch` não separa), download, total, tamanho do corpo e dos headers. `User-Agent: Otto/<versão>` quando a requisição não define um.
34. **Histórico por decorator** (`HistoryRecordingExecutor` sobre `IHttpExecutor`): grava toda execução, inclusive erros e cancelamentos (status `null`), com a origem (`collectionId` + arquivo). Remove usuário/senha embutidos na URL; se a coleção de origem sumiu, grava sem vínculo; falha ao gravar nunca afeta a resposta. Retenção em `history.maxEntries` (padrão 500, máx. 10 000, `0` desliga), aplicada a cada gravação; emite `history:changed`.
35. **Montagem da requisição em `electron/shared/http`** (função pura, testada com `node --test` e usada pelo renderer): params/headers habilitados, headers sem diferenciar maiúsculas (o último vence), auth Bearer/Basic (UTF-8)/API key em header ou query, `Content-Type` padrão por tipo de corpo sem sobrescrever o informado, `http://` quando falta o esquema. Variáveis `{{x}}` não resolvidas na URL bloqueiam o envio com mensagem (interpolação na Etapa 7).
36. **Respostas em memória** (`ResponsesState`, por arquivo): sobrevivem à troca de abas, guardam as 20 mais recentes e ignoram resultados de execuções substituídas. `Ctrl+Enter` envia; durante o envio o botão vira Cancel.
37. **Workspaces = pastas no disco** (decisão do usuário, estilo Bruno): `workspace.yaml` com `version`, `name` e `collections: [{ path }]` (relativo com `/` quando a coleção está dentro do workspace, absoluto fora). Novas coleções vão por padrão para `<workspace>/collections`. O workspace padrão ("My Workspace", id `default`) não tem pasta, vive só no banco e não pode ser removido. O ativo é o aberto por último (`last_opened_at`).
38. **O `workspace.yaml` é a fonte da verdade** da lista de coleções; a tabela `workspace_collections` (migração `003`) é a cópia usada pela barra lateral e é refeita ao carregar o workspace (pega mudanças do Git). Ao incluir/tirar coleções o arquivo é relido e editado, **preservando entradas que não existem neste computador** (de colegas); essas aparecem como aviso ao carregar. `collections_metadata.is_open` foi removido: abrir/criar coleção inclui no workspace ativo, fechar tira (sem apagar a pasta).
39. **Abas e ambientes globais por workspace** (colunas `workspace_id`). `tabs:list|save` recebem o workspace explicitamente e o `TabsState` grava pendências (`flush`) antes de trocar, para nunca salvar abas no workspace errado.
40. **Exportação/importação .zip** (`fflate`): o .zip é autocontido (`workspace.yaml` + `collections/<pasta>/…`, inclusive coleções de fora da pasta; ignora ocultos como `.git`). A importação recusa caminhos perigosos (absolutos, `..`, `\` — zip-slip), limita 500 MB / 20 mil arquivos, aceita uma pasta raiz única dentro do .zip, extrai para `<destino>/<slug do nome>` (precisa estar vazio) e descarta do manifesto coleções que apontariam para fora.
41. **Diálogos com botão no rodapé**: o `p-button` não repassa o atributo `form`, então `type="submit" form="…"` no rodapé do `p-dialog` (fora do `<form>`) não fazia nada — causa do bug "Create não cria". Os botões chamam `submit()` direto e a diretiva `EnterSubmit` faz Enter num campo enviar o formulário. Todos os `p-dialog` usam `closeAriaLabel="Close"` (o botão de fechar não tinha nome acessível).

## Etapa 1 — Concluída

- [x] Separação `electron/main`, `electron/preload`, `electron/shared` e renderer em `src/`
- [x] Modelos compartilhados de todas as entidades do plano (settings, history, tabs, environments, collections metadata)
- [x] Contratos de interface do main (executor HTTP, stores, repositórios, coleções em disco, importadores, IPC)
- [x] Contrato IPC tipado + validação de entrada no main
- [x] Refatoração de janela/menu/tray/diálogos para classes com dependências injetadas
- [x] Composition root no main; ports/adapters + `provideOttoCore()` no Angular (substitui `ElectronService`)
- [x] `package.json`: novo entry (`dist/electron/main/main.js`), `engines`, scripts `typecheck` e `test:electron`
- [x] `electron/tsconfig.json`: ES2023, `noUnusedLocals/Parameters`, `noImplicitOverride`
- [x] Verificação: `npm run typecheck` ✅, `ng build` ✅, `npm run test:electron` ✅ (14 testes), smoke test no Electron real (IPC `app:info`, `settings:get`, `http:send` com validação, `http:cancel`) ✅

## Etapa 2 — Concluída

- [x] Driver `node:sqlite` no main (`infra/database/sqlite.ts`) com helper de transação
- [x] `MigrationRunner` + migração `001-initial-schema`: `settings`, `collections_metadata`, `environments`, `history`, `tabs` (+ índices)
- [x] Repositórios: `SqliteSettingsStore` (também `IWindowStateStore`), `SqliteHistoryRepository`, `SqliteTabRepository`, `SqliteEnvironmentRepository`, `SqliteCollectionMetadataRepository`
- [x] `JsonSettingsStore` removido; importação única de `settings.json` → SQLite (arquivo vira `settings.json.migrated`)
- [x] Canais IPC: `history:list|delete|clear`, `tabs:list|save`, `environments:list|get|create|update|delete`, `collections:list|get|create|update|delete`
- [x] Preload, `OttoApi` (`HistoryApi`, `TabsApi`, `EnvironmentsApi`, `CollectionsApi`), ports e adapters Angular
- [x] Verificação: `npm run typecheck` ✅, `npm run build` ✅, `npm run test:electron` ✅ (39 testes: validadores, migrações, repositórios, importação legada, HTTP, registry), smoke test no Electron real (importação legada, CRUD de coleções/ambientes/abas, validação, unicidade, cascade, WAL) ✅

## Etapa 3 — Concluída

- [x] `OttoSettings` aninhado: `theme`, `minimizeToTray`, `http.timeoutMs` (0 = sem timeout), `http.followRedirects`, `http.proxy` (`enabled`, `url`, `bypass`), `http.ssl` (`verifyCertificates`, `caCertificatePath`); `DEFAULT_SETTINGS` e `SettingsPatch` em `shared/models/settings.ts`
- [x] Esquema/validação das preferências e `SqliteSettingsStore` reescrito sobre ele (compatível com os dados da Etapa 2)
- [x] `SettingsService` (cache + `onChange`), `ThemeController` (`nativeTheme`), canais `theme:get`, `dialog:pick-certificate`, eventos `settings:changed`/`theme:changed`
- [x] `FetchHttpExecutor` usa timeout e redirects das preferências
- [x] Menu `Settings…` (`Ctrl+,` / `Cmd+,` no menu do app no macOS) e item no menu lateral/topo; tray reflete mudanças feitas na tela
- [x] Angular: `SettingsState`, `ThemeService`, página `/settings` (PrimeNG: SelectButton, ToggleSwitch, InputNumber, InputText, Message), botões de tema do Sakai ligados ao `ThemeService`
- [x] Verificação: `npm run typecheck` ✅, `ng build` ✅, `npm run test:electron` ✅ (46 testes), E2E no Electron real via CDP: troca Light/Dark/Auto pela UI sincronizada com `nativeTheme`, proxy inválido barrado no formulário e no main, persistência após reinício, **axe-core 4.10 sem violações (WCAG 2.0/2.1/2.2 A/AA + best-practice) nos temas claro e escuro** ✅

## Etapa 4 — Concluída

- [x] Modelos `RequestDefinition` (params, headers, auth none/inherit/bearer/basic/apikey, body none/json/text/xml/form-urlencoded, docs, seq), `CollectionManifest`, árvore e `OpenedCollection`
- [x] `FsCollectionStore` + `safe-path`, `YamlCollectionFormat`, `FsCollectionWatcher`, `electronTrash`, `CollectionService`, `slugify`
- [x] IPC: `collections:open|new|close|tree`, `collection-files:read-request|save-request|create-request|create-folder|move|remove`, `dialog:choose-collection-location`, evento `collections:changed`
- [x] Angular: `CollectionFilesGateway`, `CollectionsState`; menu `Open Collection…` abre a coleção (a árvore visual é da Etapa 6)
- [x] `yaml` como dependência de runtime; README com o formato documentado
- [x] Verificação: `npm run typecheck` ✅, `ng build` ✅, `npm run test:electron` ✅ (68 testes, incluindo symlink para fora da raiz, YAML com alias bomb, ida e volta do formato), E2E no Electron real (criar coleção, criar/salvar/ler requisição, mudança externa detectada pelo watcher, path traversal e `.git` rejeitados, lixeira) ✅, **build empacotado** (`electron-builder --dir`) inclui `yaml`, exclui testes e abre coleção a partir do `app.asar` ✅

## Etapa 6 — Concluída (adiantada)

Pedido do usuário: layout semelhante ao Bruno (5 telas de referência) antes da Etapa 5.

- [x] Main: janela sem moldura, `WindowIpcModule` (`window:get-state|minimize|toggle-maximize|close|show-app-menu`, evento `window:state-changed`), migração `002-workspace-state`, `CollectionMetadata.open`, `TabState.collectionId`
- [x] Template Sakai removido (layout, páginas demo, estilos, `public/demo`, `app.routes.ts`) e dependências órfãs `chart.js` e `quill` desinstaladas
- [x] Shell: `TitleBar` (menu, home, workspace, título, alternar sidebar, minimizar/maximizar/fechar), `CollectionsSidebar` (`p-tree` com filtro, métodos coloridos, menu de contexto, criar/excluir com confirmação), `ContextHeader` (workspace × coleção, indicador OpenAPI, seletor de ambiente), `TabStrip`, `TabHost`, `StatusBar`
- [x] Conteúdos: Overview do workspace (contadores, ações rápidas, coleções), Environments globais, Preferences em aba com navegação vertical (General, Themes, Proxy, Certificates, About), Overview da coleção (Location, Requests, Environments, versão, OpenAPI, Documentation), aba de requisição (URL com `{{variáveis}}` destacadas, Params/Body/Headers/Auth/Docs, painel de resposta)
- [x] Diálogos New Collection (nome + local), New Request (nome, método, URL), New Folder — resolvem a pendência da Etapa 4
- [x] Árvore revela automaticamente a requisição ativa (expande coleção e pastas)
- [x] Verificação: `typecheck` ✅, `ng build` sem avisos ✅, `test:electron` ✅ (69 testes), E2E no Electron real via CDP (restauração da coleção após reload, clique na árvore, abas por contexto, setas do teclado, Preferences pela status bar, troca de tema, maximizar/restaurar, persistência e **restauração após reiniciar**) ✅, **axe-core sem violações** em 5 cenários (requisição e Preferences nos temas claro/escuro + Overview restaurado) ✅

## Etapa 5 — Concluída

- [x] `undici` 7.30 como dependência de runtime (versão fixa); `DispatcherProvider` (Agent × EnvHttpProxyAgent, CAs do sistema + CA personalizada, verificação de certificado)
- [x] `FetchHttpExecutor` reescrito: proxy/SSL das preferências, métricas (`timings`, `headersSize`), limite de 50 MB com streaming, base64 para binários, `charset`, URL final/`redirected`, dicas em erros de certificado, `User-Agent`, `dispose()` ao encerrar
- [x] `HistoryRecordingExecutor` (decorator) + `IHistoryRepository.prune` + preferência `history.maxEntries` (tela General) + evento `history:changed` (`HistoryApi.onChanged`)
- [x] `HttpRequest.source` validado no IPC; `buildHttpRequest` compartilhado
- [x] Renderer: Send habilitado (botão e `Ctrl+Enter`), Cancel durante o envio, `ResponsePanel` (status colorido, tempo, tamanho, redirecionamento, Body com JSON formatado e imagens, Headers, Timings, aviso de corte), avisos de "não aplicado" removidos de Proxy/Certificates
- [x] `OttoPreset`: texto das mensagens (`p-message`) no tema claro em tons 700/800 — o Aura dá 4,44:1 no erro e menos em sucesso/aviso
- [x] Verificação: `typecheck` ✅, `ng build` ✅, `test:electron` ✅ (**93 testes**, incluindo HTTPS com certificado autoassinado recusado/aceito/CA adicional, proxy HTTP com URI absoluta, túnel CONNECT, exceções do proxy, proxy fora do ar, truncamento, binário, charset, retenção do histórico), E2E no Electron real via CDP contra servidor local (GET com params/headers, POST com Bearer e JSON via `Ctrl+Enter`, cancelamento, imagem, variável não resolvida, resposta mantida ao trocar de aba, histórico gravado com origem) ✅, **axe-core sem violações em 13 cenários** (corpo, headers, tempos, enviando, erro e imagem nos temas claro/escuro + Preferences) ✅, `electron-builder --dir` inclui `undici` e exclui testes ✅

## Workspaces e correções (pedido do usuário, antes da Etapa 7)

- [x] Bug: Create Collection / New Request / New Folder não criavam nada (ver decisão 41); erro de criação agora aparece no próprio diálogo
- [x] Seletor de workspace na barra de título: lista dinâmica (ativo marcado; nomes repetidos ganham a pasta) + New Workspace, Open Workspace, Import Workspace, Manage Workspaces. Overview fica no botão Home; Environments e Preferences continuam no "+" das abas e na barra de status
- [x] Main: migração `003-workspaces`, `SqliteWorkspaceRepository`, `YamlWorkspaceFormat`, `WorkspaceService` (listar, carregar, trocar, criar, abrir, renomear, remover da lista, exportar/importar .zip), `WorkspacesIpcModule`, diálogos nativos de workspace
- [x] Renderer: `WorkspacesState` (orquestra a troca), diálogos New/Import Workspace, aba Manage Workspaces (trocar, renomear, exportar, mostrar na pasta, remover da lista), Overview e cabeçalho mostram o workspace ativo, Create Collection sugere `<workspace>/collections`
- [x] Verificação: `typecheck` ✅, `ng build` ✅, `test:electron` ✅ (105), no app real: migração de um banco existente (coleção aberta continua no My Workspace), criar workspace, criar coleção dentro dele (`workspace.yaml` atualizado), trocar, exportar e importar ✅, axe sem violações (gerenciar nos dois temas, menu, diálogos) ✅

## Método da requisição editável (pedido do usuário)

- [x] O método virou um `p-select` na barra de URL (GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD, TRACE, CONNECT); a troca grava o arquivo da requisição na hora (árvore e aba atualizam pelo watcher) e desfaz com mensagem se falhar
- [x] `HTTP_METHODS` ganhou TRACE e CONNECT. O `fetch` proíbe os dois (especificação), então o executor tem três caminhos: `fetch` (demais métodos), `request` do undici (TRACE, sem seguir redirecionamentos) e `node:http(s)` para CONNECT (mostra status/headers da resposta do túnel e o fecha; o alvo é o caminho `host:porta` da URL ou o próprio host; as preferências de proxy não se aplicam)
- [x] Verificação: `typecheck` ✅, `ng build` ✅, `test:electron` ✅ (105), troca no app real gravando o YAML ✅, axe sem violações com a lista aberta e fechada ✅

## Pasta base, importação e ambientes (pedido do usuário)

- [x] Preferência **Workspaces folder** (`workspaces.baseDirectory`, Preferences → General); vazio = `Documentos/otto` (via `app.getPath('documents')`, informado em `AppInfo.defaultBaseDirectory`). Estrutura: `<base>/<workspace>/workspace.yaml` e `<base>/<workspace>/collections/<coleção>/otto.yaml` + requisições
- [x] **New Workspace** e **Create Collection** pedem só o nome (o local vem da pasta base / do workspace ativo). Nome cujo slug já existe como pasta é recusado com mensagem
- [x] **Sem "abrir"**: removidos Open Workspace, Open Collection (menu de workspace, Manage Workspaces, barra lateral, Overview, menu nativo, tray). Workspaces e coleções de fora entram só por **importação**, que **copia** para a pasta base: Import Workspace (.zip), Import Collection (.zip exportado ou pasta com `otto.yaml`; a origem não é alterada). Novo **Export Collection** (.zip). Menu nativo: `Ctrl+O` = Import Collection…
- [x] O "My Workspace" antigo (sem pasta) ganha `<base>/my-workspace` ao carregar; as coleções que ele já tinha continuam onde estavam (caminhos absolutos no `workspace.yaml`) — nada é movido
- [x] "Close Collection" virou **Remove from Workspace** (tira do workspace; a pasta continua no disco)
- [x] **Cadastro de ambientes** (não existia — só listagem): aba Environments com lista (criar, duplicar, excluir com confirmação) e editor (nome; variáveis com habilitar, nome, valor, "secret" que oculta o valor; salvar/descartar, aviso de alterações não salvas). Serve para os globais do workspace (Overview → Environments, "+" das abas) e para os de cada coleção (botão ao lado do seletor de ambiente, menu da coleção). O seletor da coleção lista os ambientes criados; excluir o selecionado limpa a seleção
- [x] `OttoPreset`: botões de texto/contorno "danger" em `red.700` no tema claro (o Aura dá 3,8:1)
- [x] Verificação: `typecheck` ✅, `ng build` ✅, `test:electron` ✅ (94; o teste do `WorkspaceService` foi removido por testar a API de "abrir"/escolher pasta que não existe mais — pedido de não escrever testes; uma expectativa de mensagem ajustada), no app real com `HOME` isolado: pasta padrão criada, diálogos só com nome, criar workspace/coleção na pasta base, exportar e importar coleção (.zip e pasta, duplicata recusada), menus sem "Open", ambientes de coleção e globais (criar, variáveis, secret, salvar, seletor) ✅, axe sem violações (ambientes claro/escuro) ✅

## Pendências e débitos conhecidos

- O `workspace.yaml` não é observado enquanto o app está aberto: mudanças externas (git pull) entram ao trocar de workspace ou reiniciar.
- Ambientes de workspace ficam no SQLite (não vão no `workspace.yaml` nem no .zip exportado).

- Aba de requisição é **somente leitura** (já envia; edição na Etapa 7). `auth: inherit` ainda não envia nada (depende da auth da coleção, Etapa 8). Sem tela de histórico (os dados e o evento `history:changed` já existem; o tipo de aba `history` está reservado).
- Métricas não separam DNS/TCP/TLS (o `fetch` não expõe); dá para obter via `diagnostics_channel` do undici se for necessário. Proxy SOCKS não é suportado (a validação aceita só http/https). Sem certificado de cliente (mTLS).
- Exibição do corpo limitada a 1 milhão de caracteres e sem syntax highlight (visualizador completo na Etapa 7). Renomear/mover pela árvore, arrastar e soltar e redimensionar painéis (sidebar e requisição/resposta) ainda não existem.
- Seleção de ambiente por coleção fica em `localStorage` (preferência visual). A interpolação de `{{variáveis}}` no envio ainda é da Etapa 7.
- Mudar a pasta base não move workspaces existentes (continuam onde foram criados).
- O workspace é único ("My Workspace"); o menu dele leva às abas Overview/Environments/Preferences. Múltiplos workspaces não estão no plano.
- Sem testes unitários do Angular (Karma precisa de Chrome; avaliar Vitest). Estados como `TabsState` são bons candidatos.
- O estado expandido da árvore não é persistido (só é reconstruído a partir da aba ativa).
- Sem detecção de conflito de escrita (arquivo alterado no disco enquanto aberto no editor): tratar na Etapa 7 comparando conteúdo/mtime antes de salvar.
- `fs.watch` recursivo depende do SO (Linux exige Node ≥ 20; ok no Electron 44). Em falha o app segue sem atualização automática.
- Sem Content-Security-Policy no `index.html` (PrimeNG injeta estilos inline e o dev server usa websocket); definir antes da primeira release.
- A auditoria axe foi feita com `axe-core` instalado só no scratchpad; considerar adicioná-lo como devDependency com um teste automatizado.
- `eslint.config.js` está em formato legado (`root`, `extends`, `overrides`) dentro de um arquivo flat config e as dependências `@typescript-eslint`/`@angular-eslint` não estão instaladas → lint não funciona. Corrigir ou remover.
- `node:sqlite` é marcado como experimental no Node 22 (tooling); no Electron 44 (Node 24) é estável o suficiente. Os testes usam `--disable-warning=ExperimentalWarning`.
- Histórico ainda não tem política de retenção (limite de registros/idade) — definir na Etapa 5.
- Variáveis `secret` ficam em texto puro no SQLite local; avaliar `safeStorage` do Electron quando houver a aba Secrets (Etapa 8).
- Alterações em `electron/` exigem reiniciar o Electron manualmente em `npm start`.
- `@types/node` está em ^26, à frente do Node do runtime (24) e do tooling (22); cuidado com APIs novas.

## Próximos passos (Etapa 5)

1. Adicionar `undici` como dependência de runtime e migrar o `FetchHttpExecutor` para `undici.fetch` com `dispatcher`: `Agent` (`connect.rejectUnauthorized` = `ssl.verifyCertificates`, `ca` = sistema + `caCertificatePath`) e `ProxyAgent` (respeitando `proxy.bypass`). Cachear dispatchers por configuração.
2. Métricas por requisição: tempos (DNS/conexão/TTFB/download quando disponíveis), tamanho de headers/corpo, versão HTTP, redirecionamentos seguidos.
3. `HistoryRecordingExecutor` (decorator de `IHttpExecutor`) gravando no `IHistoryRepository`, com política de retenção (ex.: últimos N registros, configurável nas settings).
4. Limite de tamanho de corpo de resposta e corpo binário (base64 ou arquivo temporário) para não travar o IPC.
5. Testes com servidor HTTPS local (certificado autoassinado), proxy local e redirecionamentos.
