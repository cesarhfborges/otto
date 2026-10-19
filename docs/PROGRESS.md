# Otto — Progresso da Implementação

> Fonte da verdade sobre o estado atual do software. Atualizado a cada entrega.
> Plano original: [PLANO_IMPLEMENTACAO.md](PLANO_IMPLEMENTACAO.md).

**Última atualização:** 2026-10-19 — Etapa 6 (layout estilo Bruno) adiantada e concluída a pedido; próxima: Etapa 5.

## Visão geral

| Etapa | Descrição                                              | Status          |
| ----- | ------------------------------------------------------ | --------------- |
| 1     | Setup do boilerplate e estrutura SOLID                 | ✅ Concluída    |
| 2     | Banco de dados embutido (SQLite)                       | ✅ Concluída    |
| 3     | Configuração geral do sistema e temas                  | ✅ Concluída    |
| 4     | Ponte IPC e sistema de arquivos (local-first)          | ✅ Concluída    |
| 5     | Motor de requisições HTTP + histórico/métricas         | ⏳ Próxima — 🟡 Parcial (executor com timeout/redirects das preferências e repositório de histórico prontos; faltam proxy/SSL e gravar histórico) |
| 6     | Interface Angular (layout base e abas)                 | ✅ Concluída (adiantada, antes da 5) |
| 7     | Editor de requisição, resposta e interpolação          | 🟡 Parcial (aba de requisição em modo leitura) |
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
│   │   │   ├── http/fetch-http-executor.ts   # fetch nativo (undici), timeout, cancelamento
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
│   │   └── testing/fixtures.ts   # fakeClock, sequentialIds, migratedMemoryDb (fora do instalador)
│   ├── preload/preload.ts        # contextBridge → window.otto (só `import type` locais)
│   └── shared/                   # Tipos compartilhados main ↔ preload ↔ renderer
│       ├── ipc.ts                # IpcInvokeContract (canal → args/result), IpcEventContract
│       ├── api.ts                # OttoApi segregada: AppApi, SettingsApi, HttpApi, DialogApi, EventsApi
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

## Pendências e débitos conhecidos

- **Proxy e SSL são salvos mas ainda não aplicados** às requisições (a tela avisa). Implementar na Etapa 5 com `undici` (`ProxyAgent`/`Agent` com `connect.rejectUnauthorized` e `ca`), o que exige `undici` como dependência de runtime do main.
- Aba de requisição é **somente leitura** e o botão Send fica desabilitado (com tooltip) até as Etapas 5/7. Renomear/mover pela árvore, arrastar e soltar e redimensionar painéis (sidebar e requisição/resposta) ainda não existem.
- Seleção de ambiente por coleção fica em `localStorage` (preferência visual); edição de ambientes chega na Etapa 7.
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
