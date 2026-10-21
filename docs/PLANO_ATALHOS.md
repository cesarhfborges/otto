# Plano de Implementação — Atalhos de Teclado Configuráveis

> Status: **proposta** (nada implementado ainda). Revisar a lista de atalhos e as decisões em aberto antes de começar.

## 1. Objetivo

Criar um módulo único de atalhos que:

1. Centralize **todos** os atalhos do Otto num registro de comandos (hoje estão espalhados).
2. Permita ao usuário **reconfigurar** (trocar, adicionar, remover, restaurar o padrão) cada atalho em Preferences.
3. Execute um comando **só quando ele faz sentido no contexto** — se não houver o que fazer (ex.: `Ctrl+F4` sem aba aberta), **não faz nada** e não bloqueia o comportamento padrão da tecla.
4. Mantenha o menu nativo do Electron, as dicas visuais (`aria-keyshortcuts`, tooltips) e a tela de boas-vindas da requisição sincronizados com a configuração do usuário.

## 2. Situação atual (análise do código)

| Onde | O que faz | Problema |
| --- | --- | --- |
| `src/app/shell/shell.ts` → `onKeydown` (`document:keydown`) | `Ctrl+S` salva, `Ctrl+W` fecha aba, `Ctrl+Tab`/`Ctrl+Shift+Tab` alterna abas | Fixo no código; `Ctrl+S` dispara duas vezes (menu nativo + renderer). |
| `src/app/features/request/request-view.ts` → host `document:keydown.control.enter` / `meta.enter` | `Ctrl+Enter` envia a requisição | Escuta no `document` inteiro: dispara mesmo com um diálogo aberto por cima. |
| `src/app/features/request/request-view.ts` → `shortcuts` | Lista fixa exibida no estado vazio da requisição | Texto fixo, não reflete mudanças. |
| `electron/main/ui/menu.ts` | Aceleradores: `CmdOrCtrl+N`, `Shift+N`, `O`, `S`, `,`, `Shift+D`, `Q` | Fixos; viram `MenuAction` (`electron/shared/models/app.ts`) tratados em `Shell.onMenuAction`. |
| `src/app/shell/tab-strip.ts` → `(keydown)` | Setas/Home/End/Delete dentro da faixa de abas (padrão WAI-ARIA) | Correto — é navegação do widget, **não** deve virar atalho global. |
| `src/app/shared/enter-submit.directive.ts` | `Enter` em input envia o `<form>` dos diálogos | Correto — continua como está. |

Outros pontos relevantes encontrados:

- `TabsState` já tem `close`, `closeOthers`, `activate`, `visibleTabs`, `activeId` e um `closeGuard` (confirmação de rascunho não salvo) — os comandos de aba só orquestram isso.
- `UiState.toggleSidebar()` existe, mas não tem atalho.
- O filtro da árvore de coleções (`collections-sidebar.ts` → `filterVisible`) não tem atalho.
- A requisição tem seções `params | body | headers | auth | docs` (`Section` em `request-view.ts`) e o corpo tem formatador (`body-format.ts`).
- Preferences é um modal (`SettingsDialog`) com seções em `settings.page.ts` (`general`, `themes`, `appearance`, …) — a nova seção entra ali.
- Settings são gravadas como "folhas" chave/valor no SQLite (`core/validation/settings.ts` + `sqlite-settings.store.ts`). Um mapa de atalhos não é uma folha primitiva → precisa de chave/validação própria (ver §6).
- O menu nativo tem `role: 'reload'` (`Ctrl+R`) também em produção: recarregar o renderer descarta estado em memória. Sugestão paralela: restringir `reload`/`forceReload` ao modo dev.

## 3. Conceitos

- **Comando** (`CommandId`): ação nomeada, ex.: `tabs.close`, `request.send`. Tem rótulo, categoria, condição de habilitação (`when`) e handler.
- **Chord** (combinação): string normalizada, ex.: `Mod+Shift+T`, `Ctrl+F4`, `F2`.
  - `Mod` = `Ctrl` no Windows/Linux e `Cmd` no macOS. Os padrões usam `Mod`; o usuário pode gravar `Ctrl`/`Meta`/`Alt`/`Shift` explicitamente.
  - Ordem canônica dos modificadores: `Mod`/`Ctrl` → `Alt` → `Shift` → `Meta` → tecla.
- **Keybinding**: associação `chord → comando`. Um comando pode ter vários chords (ex.: `Mod+W` **e** `Ctrl+F4` fecham a aba). Lista vazia = comando sem atalho.
- **Contexto** (`when`): predicado avaliado no momento da tecla, a partir de *context keys* (ver §5.3).

## 4. Atalhos propostos

Legenda: **Existe** = já funciona hoje (será migrado); **Novo** = comando novo; **Novo + estado** = exige um método/estado novo em algum `*State`.
`Mod` = `Ctrl` (Win/Linux) / `Cmd` (macOS).

### 4.1 Aplicação / Geral

| Comando | Padrão | Contexto (`when`) | Origem |
| --- | --- | --- | --- |
| `app.preferences` — Abrir Preferences | `Mod+,` | sempre | Existe (menu) |
| `app.shortcuts` — Mostrar atalhos de teclado | `Mod+/` | sempre | Novo |
| `app.commandPalette` — Paleta de comandos | `Mod+Shift+P` | sempre | Novo (fase 5) |
| `theme.cycle` — Alternar tema (escuro/claro/auto) | `Mod+Shift+D` | sempre | Existe (menu) |
| `view.toggleSidebar` — Mostrar/ocultar barra lateral | `Mod+B` | sempre | Novo (`UiState.toggleSidebar` já existe) |
| `view.toggleRequestLayout` — Painéis lado a lado / empilhados | `Mod+Alt+L` | sempre | Novo (altera `appearance.requestLayout`) |
| `app.quit` — Sair | `Mod+Q` | sempre | Existe (menu, **não configurável**) |

### 4.2 Abas

| Comando | Padrão | Contexto | Origem |
| --- | --- | --- | --- |
| `tabs.close` — Fechar aba ativa | `Mod+W`, `Ctrl+F4` | `hasActiveTab && !modalOpen` | Existe (`Mod+W`) + `Ctrl+F4` novo |
| `tabs.closeOthers` — Fechar as outras abas | *(sem padrão)* | `visibleTabs > 1 && !modalOpen` | Novo (`TabsState.closeOthers` existe) |
| `tabs.closeAll` — Fechar todas as abas do contexto | `Mod+Shift+W` | `hasActiveTab && !modalOpen` | Novo + estado (`TabsState.closeAll`) |
| `tabs.reopenClosed` — Reabrir última aba fechada | `Mod+Shift+T` | `closedStack > 0` | Novo + estado (pilha de abas fechadas em `TabsState`) |
| `tabs.next` — Próxima aba | `Ctrl+Tab`, `Mod+PageDown` | `visibleTabs > 1` | Existe (`Ctrl+Tab`) |
| `tabs.previous` — Aba anterior | `Ctrl+Shift+Tab`, `Mod+PageUp` | `visibleTabs > 1` | Existe (`Ctrl+Shift+Tab`) |
| `tabs.goTo1` … `tabs.goTo8` — Ir para a aba N | `Mod+1` … `Mod+8` | existe a aba N | Novo |
| `tabs.goToLast` — Ir para a última aba | `Mod+9` | `hasActiveTab` | Novo |
| `tabs.moveLeft` / `tabs.moveRight` — Mover aba | `Mod+Shift+PageUp` / `Mod+Shift+PageDown` | `visibleTabs > 1` | Novo + estado (`TabsState.move`) |

> `Ctrl+F4` sem aba ativa (ou com diálogo aberto) → `when` falso → **nada acontece**, conforme pedido.
> Observação: o contexto "workspace" nunca fica vazio (`ensureWorkspaceTab` reabre o Overview). Fechar a última aba do workspace reabre o Overview — comportamento mantido.

### 4.3 Requisição (aba do tipo `request` ativa)

| Comando | Padrão | Contexto | Origem |
| --- | --- | --- | --- |
| `request.send` — Enviar requisição | `Mod+Enter` | `activeTab == request && !sending && !modalOpen && !formFocus` | Existe |
| `request.cancel` — Cancelar envio | `Escape` | `activeTab == request && sending && !modalOpen && !overlayOpen` | Novo (`ResponsesState.cancel` existe) |
| `request.save` — Salvar requisição | `Mod+S` | `activeTab == request && dirty` | Existe |
| `request.saveAll` — Salvar todas | `Mod+Alt+S` | `anyDirty` | Novo + estado (`RequestDraftsState.saveAll`) |
| `request.focusUrl` — Focar a URL | `Mod+L` | `activeTab == request` | Novo |
| `request.section.params` | `Alt+1` | `activeTab == request` | Novo |
| `request.section.body` | `Alt+2` | `activeTab == request && bodyAllowed` | Novo |
| `request.section.headers` | `Alt+3` | `activeTab == request` | Novo |
| `request.section.auth` | `Alt+4` | `activeTab == request` | Novo |
| `request.section.docs` | `Alt+5` | `activeTab == request` | Novo |
| `request.formatBody` — Formatar corpo (JSON/XML) | `Shift+Alt+F` | `activeTab == request && bodyAllowed` | Novo (usa `body-format.ts`) |

> No macOS `Alt+número` digita caracteres (`¡`, `™`…). Como a tecla é lida por `event.code` (ver §5.2), o atalho continua funcionando, mas no macOS o padrão sugerido é `Ctrl+1…5` (o `Mod` lá é `Cmd`, então `Ctrl` fica livre).

### 4.4 Formulários e diálogos

| Comando | Padrão | Contexto | Origem |
| --- | --- | --- | --- |
| `form.submit` — Enviar o formulário em foco | `Mod+Enter` | `formFocus` (foco dentro de um `<form>`) | Novo |
| *(fixo)* Enviar com Enter em campo de texto | `Enter` | `form[appEnterSubmit]` | Existe (diretiva, não configurável) |
| *(fixo)* Fechar diálogo | `Escape` | diálogo aberto | PrimeNG (não configurável) |

> `Mod+Enter` é compartilhado por `form.submit` e `request.send`: a resolução por prioridade (§5.4) decide. Foco num formulário de diálogo → envia o formulário; foco no editor da requisição → envia a requisição.
> `form.submit` usa `form.requestSubmit()` (dispara `ngSubmit` e respeita validação), igual à `EnterSubmit`. Funciona também em `<textarea>`, onde `Enter` sozinho quebra linha.

### 4.5 Coleções e workspace

| Comando | Padrão | Contexto | Origem |
| --- | --- | --- | --- |
| `collection.newRequest` — Nova requisição | `Mod+N` | sempre (sem coleção → toast "Open a collection first", já existente) | Existe (menu) |
| `collection.newFolder` — Nova pasta | `Mod+Alt+N` | `context == collection` | Novo |
| `collection.new` — Nova coleção | `Mod+Shift+N` | sempre | Existe (menu) |
| `collection.import` — Importar coleção | `Mod+O` | sempre | Existe (menu) |
| `sidebar.focus` — Focar a árvore de coleções | `Mod+Shift+E` | `sidebarVisible` (se oculta, mostra antes) | Novo |
| `sidebar.filter` — Filtrar requisições | `Mod+Shift+F` | sempre (mostra a barra e liga o filtro) | Novo |
| `sidebar.rename` — Renomear item selecionado | `F2` | `treeFocus` | Novo (`askRename` existe) |
| `sidebar.duplicate` — Duplicar item selecionado | `Mod+D` | `treeFocus` | Novo (`askDuplicate` existe) |
| `sidebar.delete` — Excluir item selecionado | `Delete` (macOS: `Mod+Backspace`) | `treeFocus` | Novo (`confirmDelete` existe, com confirmação) |
| `environment.select` — Abrir seletor de ambiente | `Mod+E` | `context == collection` | Novo (abre o `p-select` do `ContextHeader`) |
| `environment.manage` — Gerenciar ambientes | *(sem padrão)* | `context == collection` | Novo |
| `workspace.manage` — Gerenciar workspaces | *(sem padrão)* | sempre | Novo |
| `collection.overview` — Abrir visão geral da coleção | *(sem padrão)* | `context == collection` | Novo |

### 4.6 Teclas reservadas (não configuráveis, apenas listadas na tela de atalhos)

- Edição: `Mod+C/V/X/Z/Shift+Z/A` (`role: 'editMenu'`).
- Zoom e janela: `Mod+=`, `Mod+-`, `Mod+0`, `F11` (roles nativos).
- Foco: `Tab`, `Shift+Tab`.
- Navegação de widgets (WAI-ARIA): setas/Home/End/Delete na faixa de abas, setas na árvore, setas no divisor do splitter.
- `Escape` em diálogos/menus/overlays.

A gravação de atalho na tela de Preferences **recusa** essas teclas (mensagem: "reservado pelo sistema").

## 5. Arquitetura

### 5.1 Visão geral do fluxo

```
            keydown (document, fase de captura)
                          │
                          ▼
   ┌─────────────────── KeybindingService ───────────────────┐
   │ 1. ignora: isComposing, modo "gravar atalho", tecla só   │
   │    modificadora, auto-repeat (salvo comandos repetíveis)  │
   │ 2. eventToChord(event)  → "Mod+Shift+T"                   │
   │ 3. bindings().get(chord) → [CommandId…] (ordem prioridade)│
   │ 4. 1º comando cujo when(ctx) == true e tem handler        │
   │      ├─ achou → preventDefault + stopPropagation          │
   │      │           CommandRegistry.execute(id)              │
   │      └─ não achou → retorna (tecla segue seu curso normal)│
   └──────────────────────────────────────────────────────────┘

Menu nativo (Electron) ── click ──► menu:action {type:'command', id} ──► CommandRegistry.execute(id)
```

O **renderer é a fonte da verdade** dos atalhos. O menu nativo apenas *exibe* os atalhos e executa comandos pelo clique.

### 5.2 Normalização das teclas (`chord.ts`, funções puras)

- **Letras e dígitos** → `event.code` (`KeyT` → `T`, `Digit1` → `1`). Independe de layout/modificador: `Alt+1` no macOS gera `¡` em `event.key`, mas `event.code` é `Digit1`; `Shift+1` não vira `!`.
- **Demais teclas** (`Enter`, `Escape`, `F1…F12`, `Tab`, `PageUp`, `Delete`, `/`, `,`, `=`…) → `event.key`, com nomes canônicos (`ArrowUp`, `Space` para `' '`).
  - Para pontuação usa `event.key`, pois no ABNT2/US a posição física difere; `Mod+,` deve funcionar em qualquer layout.
- **Modificadores**: no macOS `metaKey` → `Mod`, `ctrlKey` → `Ctrl`; no Win/Linux `ctrlKey` → `Mod`, `metaKey` → `Meta`.
- **AltGr** (Windows/Linux ABNT2) chega como `Ctrl+Alt`: se `event.getModifierState('AltGraph')` for verdadeiro, o evento é ignorado (é digitação).
- Funções: `eventToChord(event, platform)`, `parseChord(text)`, `normalizeChord(text)`, `formatChord(chord, platform)` (exibição: `Ctrl + Shift + T` / `⌘⇧T`), `toElectronAccelerator(chord)` (`Mod` → `CmdOrCtrl`).
- A plataforma vem do `AppInfoGateway` (já existe) ou `navigator.userAgentData`, injetada como token para manter as funções puras.

### 5.3 Contexto (`ContextKeys`)

Serviço com signals/`computed` derivados dos estados existentes + rastreamento de foco:

| Context key | Fonte |
| --- | --- |
| `hasActiveTab`, `visibleTabs`, `activeTab` (kind) | `TabsState` |
| `context == collection` | `TabsState.context()` |
| `dirty`, `anyDirty` | `RequestDraftsState` |
| `sending`, `bodyAllowed` | `ResponsesState` / definição da requisição ativa |
| `sidebarVisible` | `UiState` |
| `closedStack` | `TabsState` (novo) |
| `modalOpen` | no momento da tecla: existe `[role="dialog"][aria-modal="true"]` visível no DOM (cobre `p-dialog`, `DynamicDialog` de Preferences e o `ConfirmHost`) |
| `overlayOpen` | menu/select/popup do PrimeNG aberto (`.p-overlay`, `.p-menu-overlay`, `.p-select-overlay`) |
| `inputFocus` | `document.activeElement` é `input`/`textarea`/`[contenteditable]` |
| `formFocus` | `activeElement.closest('form')` |
| `treeFocus` | `activeElement.closest('app-collections-sidebar [role="tree"]')` |

Os dados de DOM são lidos **na hora da tecla** (não precisam ser signals); os de estado são signals já existentes. O `when` é uma função `(ctx: ContextSnapshot) => boolean` — sem mini-linguagem de expressões como no VS Code (desnecessário aqui; pode vir depois se a paleta precisar).

### 5.4 Resolução de conflitos e prioridade

Quando um chord mapeia para vários comandos, a ordem de tentativa é por **escopo** do comando:

1. `recording` — tela de gravação de atalho ativa (captura tudo, nada executa).
2. `modal` — comandos válidos dentro de diálogo (`form.submit`).
3. `focus` — dependem do elemento focado (`treeFocus`, `formFocus`, editor).
4. `tab` — dependem do tipo da aba ativa (`request.*`).
5. `global` — demais.

Regras:
- Executa **só o primeiro** comando habilitado. Nenhum habilitado → **não chama `preventDefault`** (ex.: `Ctrl+F4` sem aba não faz nada e não interfere).
- Comandos `global`/`tab` têm `!modalOpen` implícito, para nenhum atalho agir "por trás" de um diálogo (corrige o `Ctrl+Enter` atual).
- Atalhos **sem modificador** (`F2`, `Delete`, `Escape`, `Alt+n` não conta) só são aceitos em comandos com escopo `focus` ou com `when` restritivo — evita sequestrar digitação. Atende o WCAG 2.1.4 (*Character Key Shortcuts*): nenhum atalho global de tecla única, e todos podem ser remapeados ou desligados.
- Em `inputFocus`, comandos `global` sem `Mod`/`Alt` não executam.

### 5.5 Registro de comandos (`CommandRegistry`)

```ts
// electron/shared/models/keybindings.ts  (compartilhado main ↔ renderer)
export const COMMAND_IDS = ['app.preferences', 'tabs.close', 'request.send', /* … */] as const;
export type CommandId = (typeof COMMAND_IDS)[number];
export type KeyChord = string; // normalizado, ex.: "Mod+Shift+T"
export type KeybindingOverrides = Partial<Record<CommandId, KeyChord[]>>; // [] = desligado
export interface CommandMeta { id: CommandId; label: string; category: 'App' | 'Tabs' | 'Request' | 'Collections' | 'Forms'; scope: CommandScope; defaults: { default: KeyChord[]; mac?: KeyChord[] }; configurable: boolean; repeatable?: boolean }
export const COMMANDS: readonly CommandMeta[] = [/* tabela da §4 */];
```

No renderer (`src/app/core/keyboard/`):

```ts
@Injectable({ providedIn: 'root' }) // projeto em Angular 21: @Service ainda não disponível
export class CommandRegistry {
    /** Handlers globais (registrados no bootstrap) e de escopo (registrados por componentes). */
    register(id: CommandId, handler: CommandHandler): () => void; // devolve o "unregister"
    isEnabled(id: CommandId): boolean;
    execute(id: CommandId): boolean; // false se desabilitado/sem handler
}

interface CommandHandler { when?: (ctx: ContextSnapshot) => boolean; run: () => void | Promise<void> }
```

- **Comandos globais** (abas, tema, sidebar, diálogos, preferences) registrados num único arquivo `app-commands.ts` via `provideAppInitializer`, chamando os `*State` existentes. A lógica que hoje está em `Shell.onKeydown`/`Shell.onMenuAction` migra para lá.
- **Comandos de escopo** (ex.: `request.send`, `request.focusUrl`, `request.section.*`) registrados pelo componente que tem o estado/elementos, com remoção no `DestroyRef`:
  ```ts
  // RequestView
  inject(CommandRegistry).register('request.send', { when: (ctx) => !ctx.sending, run: () => this.send() });
  ```
  Só a aba ativa está renderizada no `TabHost`, então há no máximo um handler de `request.*` registrado. Se algum dia várias views coexistirem, o registro vira pilha (último registrado vence).
- Erros de handler assíncrono viram toast (mesmo padrão de `Shell.saveActive`).

### 5.6 `KeybindingService`

- `effectiveBindings = computed(() => merge(COMMANDS.defaults[platform], overrides()))` → `Map<KeyChord, CommandId[]>` ordenado por escopo.
- `conflicts = computed(...)` → chords com 2+ comandos **do mesmo escopo** (usado na UI de Preferences).
- Um único listener `document.addEventListener('keydown', …, { capture: true })` registrado no bootstrap (fora de componente, com cleanup no `DestroyRef` do `ApplicationRef`). Captura é necessária porque componentes do PrimeNG chamam `stopPropagation` em algumas teclas.
- `chordFor(id)` / `labelFor(id)` (signals) para tooltips, `aria-keyshortcuts` e textos de ajuda.

### 5.7 Dicas na interface

- Diretiva `appShortcut="request.send"`: preenche `aria-keyshortcuts` (formato ARIA, ex.: `Control+Enter`) e acrescenta o atalho ao `title`/tooltip. Substitui os textos fixos como `ariaLabel="Send request (Ctrl+Enter)"`.
- O estado vazio da requisição (`RequestView.shortcuts`) passa a ler do `KeybindingService`.
- `tab-strip.ts` mantém `aria-keyshortcuts="Delete"` (widget local).

## 6. Persistência e processo principal (Electron)

### 6.1 Armazenamento

- Gravar **apenas as diferenças** em relação ao padrão (`KeybindingOverrides`), numa linha própria da tabela `settings` (`key = 'keybindings'`, valor JSON). Atualizações de versão que mudem um padrão chegam ao usuário automaticamente, exceto nos comandos que ele personalizou.
- Não entra em `OttoSettings`/`SettingsPatch` (o modelo de folhas primitivas não comporta um mapa); fica num contrato próprio:
  - `electron/main/core/contracts/keybinding-store.ts` → `IKeybindingStore { get(): KeybindingOverrides; set(o): void }`.
  - `electron/main/infra/repositories/sqlite-keybinding.store.ts` (reusa a tabela `settings`, sem migração nova).
  - `electron/main/core/validation/keybindings.ts`: `CommandId` conhecido, chords válidos (`parseChord`), sem teclas reservadas, no máx. 4 chords por comando. IDs desconhecidos (de versões futuras/antigas) são descartados ao ler.

### 6.2 IPC

| Canal | Tipo | Descrição |
| --- | --- | --- |
| `keybindings:get` | invoke | Retorna `KeybindingOverrides`. |
| `keybindings:set` | invoke | Recebe o objeto completo de overrides, valida, grava e reconstrói o menu. |
| `keybindings:reset` | invoke | `(id?: CommandId)` — restaura um comando ou todos. |
| `keybindings:changed` | evento | Notifica o renderer (mantém consistência se houver mais de uma janela no futuro). |

Seguir o padrão existente: `electron/shared/ipc.ts` (contrato), `electron/main/ipc/keybindings.ipc.ts`, `preload.ts`, `core/ports` (`KeybindingsGateway`) e `adapters/electron/electron-gateways.ts`. Estado no renderer: `src/app/core/state/keybindings.state.ts` (load/set/reset, signal `overrides`).

### 6.3 Menu nativo

- `buildAppMenu(commands, bindings)` passa a receber os atalhos efetivos; cada item usa `accelerator: toElectronAccelerator(chord)` e **`registerAccelerator: false`** (Windows/Linux): o menu mostra o atalho, mas quem trata a tecla é o renderer. Isso elimina o disparo duplo atual do `Ctrl+S`.
- Clique no item envia `menu:action` `{ type: 'command', id }`. `MenuAction` vira genérico (`{ type: 'command'; id: CommandId }`) e `Shell.onMenuAction` some — o assinante chama `CommandRegistry.execute(id)`.
- O tray (`ui/tray.ts`/`AppCommands`) continua usando os mesmos ids.
- **macOS**: o menu da barra global intercepta aceleradores antes do renderer mesmo com `registerAccelerator: false` em alguns casos. Fazer um *spike* curto na fase 3; se houver duplicidade, o `CommandRegistry.execute` ignora o mesmo comando repetido em < 100 ms (debounce por id), o que torna o caminho seguro em qualquer SO.
- Menu reconstruído (`Menu.setApplicationMenu`) a cada `keybindings:set/reset`.
- Teclas que o Chromium/Electron consome antes do renderer (se aparecer alguma no teste, ex.: `Ctrl+Tab` em certas plataformas) são encaminhadas pelo `webContents.on('before-input-event')` → `menu:action`. Só implementar se o teste manual mostrar necessidade.

## 7. Interface de configuração (Preferences → "Keyboard Shortcuts")

Nova seção em `settings.page.ts` (`id: 'shortcuts'`, ícone `pi pi-key`), componente próprio `features/settings/keyboard-shortcuts.ts`:

- Campo de busca (por nome do comando **ou** pelo atalho, ex.: digitar "ctrl+w").
- Tabela agrupada por categoria: Comando · Atalho(s) · Ações.
  - Cada atalho é um "chip" `<kbd>` com botão remover.
  - **Adicionar/Alterar**: entra em modo de gravação (`role="dialog"` pequeno ou campo inline com `aria-live="polite"` dizendo "Press the new shortcut, Escape to cancel"). O `KeybindingService` entra no escopo `recording` e não executa nada. `Escape` cancela; `Backspace` sozinho limpa.
  - Avisos: conflito no mesmo escopo ("Already used by *Close tab* — replace?"), tecla reservada, tecla única fora de escopo `focus`.
  - **Restaurar padrão** por linha (visível só quando personalizado, com marca "Modified") e **Restaurar todos** (confirmação via `ConfirmHost`).
- Comandos não configuráveis aparecem desabilitados com o motivo.
- Acessibilidade: tabela com `<th scope>`, botões com `aria-label` específico ("Change shortcut for Close tab"), foco devolvido ao botão de origem ao terminar a gravação, contraste dos `<kbd>` AA nos temas claro/escuro, passar no AXE.

Também:
- **Diálogo "Keyboard Shortcuts"** (`app.shortcuts`, `Mod+/`): lista somente leitura com busca e link "Customize…" para a seção de Preferences.
- **Paleta de comandos** (`app.commandPalette`, fase 5): `p-dialog` + lista filtrável sobre `COMMANDS` habilitados, exibindo o atalho de cada um; `Enter` executa. Base para depois incluir "abrir requisição" (busca nas árvores das coleções).

## 8. Estrutura de arquivos

```
electron/shared/models/keybindings.ts           # CommandId, COMMANDS, defaults, tipos
electron/shared/keyboard/chord.ts               # parse/normalize/format/toElectronAccelerator (puro, usado nos dois lados)
electron/main/core/contracts/keybinding-store.ts
electron/main/core/validation/keybindings.ts
electron/main/infra/repositories/sqlite-keybinding.store.ts
electron/main/ipc/keybindings.ipc.ts
electron/main/ui/menu.ts                        # alterado: atalhos dinâmicos, registerAccelerator:false
electron/main/ui/commands.ts                    # alterado: envia { type:'command', id }
electron/shared/models/app.ts                   # MenuAction genérico
electron/shared/ipc.ts, electron/preload/preload.ts

src/app/core/keyboard/command-registry.ts
src/app/core/keyboard/keybinding.service.ts
src/app/core/keyboard/context-keys.ts
src/app/core/keyboard/app-commands.ts           # comandos globais (provideAppInitializer)
src/app/core/keyboard/shortcut.directive.ts     # aria-keyshortcuts + tooltip
src/app/core/state/keybindings.state.ts
src/app/core/ports/index.ts, adapters/electron/electron-gateways.ts
src/app/features/settings/keyboard-shortcuts.ts # seção de Preferences
src/app/features/settings/shortcuts-dialog.ts   # Mod+/
src/app/features/command-palette/command-palette.ts (fase 5)

Alterados para migrar o que existe:
src/app/shell/shell.ts                          # remove onKeydown/onMenuAction
src/app/features/request/request-view.ts        # remove host listeners; registra request.*; shortcuts dinâmicos
src/app/core/state/tabs.state.ts                # closeAll, move, pilha de reabertura
src/app/core/state/request-drafts.state.ts      # saveAll
src/app/features/collections/collections-sidebar.ts  # rename/duplicate/delete/filter/focus expostos como comandos
src/app/shell/context-header.ts                 # abrir seletor de ambiente
```

## 9. Fases de implementação

1. **Infraestrutura + migração sem mudança de comportamento**
   `chord.ts`, `keybindings.ts` (modelos e defaults), `CommandRegistry`, `ContextKeys`, `KeybindingService` só com defaults (sem persistência).
   Migrar `Shell.onKeydown`, os listeners de `RequestView` e `Shell.onMenuAction`.
   Já incluir `Ctrl+F4` (fechar aba) e `form.submit` (`Mod+Enter` no formulário em foco) e o `!modalOpen` do envio.
2. **Novos comandos** da §4 (abas, requisição, sidebar, ambiente), incluindo os métodos novos em `TabsState` e `RequestDraftsState`.
3. **Persistência + IPC + menu dinâmico** (§6), com o spike do macOS.
4. **UI**: seção "Keyboard Shortcuts" em Preferences, diálogo `Mod+/`, diretiva `appShortcut` aplicada nos botões existentes, estado vazio da requisição dinâmico.
5. **Paleta de comandos** (opcional).

Cada fase termina com `npm run typecheck`, `npm run build` e verificação manual no app (sem testes unitários, conforme combinado).

## 10. Roteiro de verificação manual

- `Ctrl+F4` e `Mod+W` com aba ativa fecham; com rascunho sujo pedem confirmação (closeGuard); com diálogo aberto não fazem nada.
- `Mod+Enter`: num diálogo (ex.: New Request) envia o formulário; no editor da requisição envia a requisição; com Preferences aberto não envia a requisição.
- `Ctrl+S` salva **uma** vez (sem disparo duplo do menu).
- Atalho sem comando habilitado não bloqueia a tecla (ex.: `Ctrl+F4` digitando num input sem aba → nada muda).
- Digitar em inputs/textarea não aciona atalhos de tecla única (`F2`/`Delete` só na árvore).
- Layout ABNT2 com AltGr (`AltGr+Q` = `/`) não dispara `Ctrl+Alt+…`.
- Personalizar um atalho, reiniciar o app → mantido; menu nativo mostra o novo atalho; "Restaurar padrão" volta.
- Conflito é avisado na gravação; tecla reservada é recusada.
- AXE limpo na seção de Preferences e no diálogo de atalhos; navegação só por teclado funciona; foco volta ao botão de origem.

## 11. Decisões em aberto

1. **`Mod+Enter`** deve **também** enviar formulários quando o foco está num `<textarea>` dentro de um diálogo? (Proposta: sim.)
2. **`Escape` para cancelar envio**: ok, ou preferir um chord explícito (ex.: `Mod+.`) para evitar conflito com fechamento de overlays?
3. **Abas — `Mod+1…9`**: contam só as abas do contexto atual (coleção/workspace visível)? (Proposta: sim, como a faixa exibe.)
4. **Sequências de teclas** (chords em dois passos, estilo `Ctrl+K Ctrl+S`): fora do escopo inicial; o formato `KeyChord` pode evoluir para `KeyChord[]` depois sem quebrar a persistência (migrar no validador).
5. **`reload` em produção** (`Ctrl+R` descarta rascunhos em memória): restringir ao modo dev junto com esta entrega?
