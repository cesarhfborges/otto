# Otto — Progresso da Implementação

> Fonte da verdade sobre o estado atual do software. Atualizado a cada entrega.
> Plano original: [PLANO_IMPLEMENTACAO.md](PLANO_IMPLEMENTACAO.md).

**Última atualização:** 2026-10-18 — Etapa 3 concluída.

## Visão geral

| Etapa | Descrição                                              | Status          |
| ----- | ------------------------------------------------------ | --------------- |
| 1     | Setup do boilerplate e estrutura SOLID                 | ✅ Concluída    |
| 2     | Banco de dados embutido (SQLite)                       | ✅ Concluída    |
| 3     | Configuração geral do sistema e temas                  | ✅ Concluída    |
| 4     | Ponte IPC e sistema de arquivos (local-first)          | ⏳ Próxima      |
| 5     | Motor de requisições HTTP + histórico/métricas         | 🟡 Parcial (executor com timeout/redirects das preferências e repositório de histórico prontos; faltam proxy/SSL e gravar histórico) |
| 6     | Interface Angular (layout base e abas)                 | ⬜ Pendente     |
| 7     | Editor de requisição, resposta e interpolação          | ⬜ Pendente     |
| 8     | Collections (estilo Bruno), importação e sync OpenAPI  | 🟡 Parcial (só contratos + registry) |

## Stack efetiva

| Item          | Versão                         | Observação |
| ------------- | ------------------------------ | ---------- |
| Node.js (dev) | 22.23 (`.nvmrc` = 22, `engines >= 22.12`) | Tooling, build e testes do main. |
| Electron      | 44.9.0                         | Embute **Node 24.22** / Chromium 152 em runtime. |
| Angular       | 21.0.x (standalone, zoneless, signals) | `@Service` (v22) ainda não disponível → `@Injectable`. |
| UI            | PrimeNG 21 + Tailwind 4 (template Sakai-NG) | |
| TypeScript    | 5.9                            | `strict` em ambos os projetos. |
| SQLite        | `node:sqlite` (SQLite 3.53)    | Validado dentro do Electron 44; sem módulo nativo. |

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
│   │   │   ├── collection-store.ts     ICollectionStore (sistema de arquivos)
│   │   │   ├── collection-importer.ts  ICollectionImporter + modelos de importação
│   │   │   ├── database.ts             Migration, IMigrationRunner
│   │   │   ├── system.ts               IClock, IIdGenerator
│   │   │   └── ipc-module.ts           IIpcModule, IIpcRegistrar, IpcHandler
│   │   ├── core/validation/      # unknown → tipos do contrato (guards + um arquivo por agregado)
│   │   │   └── settings.ts       # SETTING_LEAVES: esquema das preferências (parse de patch e leitura do banco)
│   │   ├── services/
│   │   │   ├── http/fetch-http-executor.ts   # fetch nativo (undici), timeout, cancelamento
│   │   │   ├── import/importer-registry.ts   # Registro de importadores (OCP)
│   │   │   └── settings/settings.service.ts  # Decorator do store: cache + evento de mudança
│   │   ├── infra/
│   │   │   ├── database/         # openDatabase, transaction, MigrationRunner, migrations/NNN-*.ts
│   │   │   ├── repositories/     # Sqlite*Repository / SqliteSettingsStore
│   │   │   ├── settings/legacy-settings-import.ts  # settings.json → SQLite (uma vez)
│   │   │   └── system/           # systemClock, uuidGenerator
│   │   ├── ipc/                  # Um módulo IPC por responsabilidade
│   │   │   ├── handle.ts         # ElectronIpcRegistrar (rejeita sender não confiável)
│   │   │   ├── app.ipc.ts, settings.ipc.ts, theme.ipc.ts, http.ipc.ts
│   │   │   └── history.ipc.ts, tabs.ipc.ts, environments.ipc.ts, collections.ipc.ts
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
│       └── models/               # Entidades: http, settings, history, tab, environment, collection, app, common
└── src/                          # Renderer (Angular)
    ├── types/otto.d.ts           # window.otto
    └── app/core/
        ├── bridge/otto-api.token.ts      # InjectionToken OTTO_API + BridgeUnavailableError
        ├── ports/index.ts                # Classes abstratas (tokens de DI): *Gateway
        ├── adapters/electron/electron-gateways.ts  # Implementações sobre IPC
        ├── state/settings.state.ts       # SettingsState (signals; fonte da verdade no main)
        ├── theme/theme.service.ts        # ThemeService (preferência × tema efetivo, classe .app-dark)
        ├── theme/accessible-tokens.ts    # Ajustes de contraste AA sobre o preset Aura
        └── providers.ts                  # provideOttoCore() (+ inicializa o ThemeService)
    └── app/features/settings/            # Página de configurações (rota lazy /settings)
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
14. **Tema**: a preferência (`light`/`dark`/`auto`) vive nas settings; o main aplica em `nativeTheme.themeSource` (afeta menus/diálogos nativos e `prefers-color-scheme`) e emite `theme:changed`. No renderer, `ThemeService` é a fonte única (classe `.app-dark`); o `LayoutService` do Sakai só espelha. Para evitar flash branco no escuro, a janela nasce com `backgroundColor` do tema e o preload aplica `.app-dark` no `DOMContentLoaded` (via `additionalArguments`).
15. **Eventos main → renderer** via `IRendererNotifier` (`settings:changed`, `theme:changed`): mudanças feitas pelo tray aparecem na tela de configurações. Durante o carregamento da página eventos são descartados; o Angular busca o estado ao iniciar.
16. **Formulário de configurações com auto-save**: reactive forms; toggles/seletores salvam na hora e campos de texto ao sair do campo (`updateOn: 'blur'`). O main é a fonte da verdade: o valor salvo (validado) volta para o formulário.
17. **Sem recursos externos no renderer**: removidos a fonte do `fonts.cdnfonts.com` e o `preconnect` para `primefaces.org` (violavam a premissa offline/sem telemetria); usa pilha de fontes do sistema.
18. **Contraste AA**: o preset Aura tem 4,34:1 nas opções não selecionadas do `SelectButton`; `ACCESSIBLE_TOKENS` corrige (aplicado no `providePrimeNG` e no configurador do Sakai, que reaplica o preset ao iniciar).
19. **Testes do main** com `node --test` sobre o JS compilado (`npm run test:electron`). Código testado não pode importar `electron`. Arquivos `*.test.js` são excluídos do instalador.

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

## Pendências e débitos conhecidos

- **Proxy e SSL são salvos mas ainda não aplicados** às requisições (a tela avisa). Implementar na Etapa 5 com `undici` (`ProxyAgent`/`Agent` com `connect.rejectUnauthorized` e `ca`), o que exige `undici` como dependência de runtime do main.
- O configurador de cores do Sakai (`app.configurator.ts`) e o `LayoutService` continuam ativos até a Etapa 6; trocar preset por ele mantém os tokens de acessibilidade, mas cor primária/superfície não são persistidas.
- Sem Content-Security-Policy no `index.html` (PrimeNG injeta estilos inline e o dev server usa websocket); definir na Etapa 6 junto com a limpeza do template.
- A auditoria axe foi feita com `axe-core` instalado só no scratchpad; considerar adicioná-lo como devDependency com um teste automatizado.
- `eslint.config.js` está em formato legado (`root`, `extends`, `overrides`) dentro de um arquivo flat config e as dependências `@typescript-eslint`/`@angular-eslint` não estão instaladas → lint não funciona. Corrigir ou remover.
- Páginas demo do Sakai (`dashboard`, `uikit`, `landing`, `auth`, `crud`, `documentation`) ainda presentes; serão removidas na Etapa 6. São a causa do aviso de budget (1,76 MB inicial).
- `node:sqlite` é marcado como experimental no Node 22 (tooling); no Electron 44 (Node 24) é estável o suficiente. Os testes usam `--disable-warning=ExperimentalWarning`.
- Histórico ainda não tem política de retenção (limite de registros/idade) — definir na Etapa 5.
- Variáveis `secret` ficam em texto puro no SQLite local; avaliar `safeStorage` do Electron quando houver a aba Secrets (Etapa 8).
- Alterações em `electron/` exigem reiniciar o Electron manualmente em `npm start`.
- `@types/node` está em ^26, à frente do Node do runtime (24) e do tooling (22); cuidado com APIs novas.

## Próximos passos (Etapa 4)

1. Definir o formato em disco (README): `otto.yaml` (metadados da coleção), uma requisição por arquivo `.yaml`, pastas como agrupamento; adicionar `yaml` como dependência de runtime do main.
2. `FsCollectionStore` implementando `ICollectionStore`: leitura da árvore, leitura/escrita/remoção com proteção contra path traversal (caminhos sempre dentro da raiz), escrita atômica.
3. Serializer/parser de requisição (`RequestFile` ↔ YAML) desacoplado do store (SRP), com validação.
4. Mapeamento disco ↔ banco: abrir pasta registra/atualiza `collections_metadata` (`lastOpenedAt`); criar coleção nova gera `otto.yaml`.
5. Canais IPC `collections:open|tree|read-request|write-request|delete-request` + ligação com o menu `Open Collection…` / `New Collection`.
6. Testes com diretórios temporários.
