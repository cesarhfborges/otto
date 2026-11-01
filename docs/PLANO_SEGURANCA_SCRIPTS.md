# Plano — Política de segurança dos scripts por coleção (indicador + aba Security)

> Status: **implementado** (2026-11-01), fases 1 a 6. Decisões: D1 envia sem os scripts; D2 `sendRequests`/`readSecrets` desligados fora do `trusted`; D3 limites só exibidos; D4 indicador oculto sem scripts; D5 política por coleção. Continuação de [PLANO_SANDBOX_SCRIPTS.md](PLANO_SANDBOX_SCRIPTS.md).

## 1. Objetivo

1. Deixar **visível** o estado de segurança dos scripts da coleção em uso: um indicador na `app-status-bar`.
2. Criar uma aba **Security** na página da coleção (ao lado de Overview, Auth, Scripts…), onde se **define o modo de segurança** e se **revisa a política**: o que a coleção tem de scripts, o que eles fazem, desde quando são confiáveis e o que mudou desde então.

## 2. Situação atual

- O sandbox (QuickJS) roda todo script com os mesmos limites fixos (`DEFAULT_SANDBOX_LIMITS` em `script-sandbox.ts`) e com acesso a toda a API `otto`.
- A confiança é **um booleano** (`collections_metadata.scripts_trusted`, migração 006). Coleções de fora nascem `false`.
- A decisão de sessão (*Allow Until Restart* / *Don't Run*) fica num `Map` privado do `ScriptTrust`, sem aparecer em lugar nenhum.
- A única UI é o aviso no topo da aba **Scripts** da coleção (`scope-scripts.ts`).
- **Brecha:** a confiança não está presa ao conteúdo. Depois de *Trust Collection*, um `git pull` que altere ou acrescente scripts roda sem perguntar.

## 3. Conceitos

### 3.1 Modo de segurança (`ScriptMode`)

| Modo | Rótulo na UI | Comportamento | Padrão para |
| --- | --- | --- | --- |
| `trusted` | **Trusted** | Roda sem perguntar, desde que os scripts não tenham mudado desde a confiança (§3.3) | Coleções criadas no app |
| `ask` | **Ask before running** | Pergunta uma vez por sessão (diálogo atual) | Coleções importadas ou vindas do Git |
| `disabled` | **Scripts disabled** | Nunca roda scripts. A requisição é enviada sem eles, e a timeline/console registra "scripts skipped (disabled by the collection's security policy)" | Escolha do usuário |

> Decisão em aberto D1: em `disabled`, **enviar sem os scripts** (proposto) ou **bloquear o envio**? Enviar sem eles é mais útil para inspecionar uma coleção suspeita; bloquear é mais seguro quando o pre-request monta auth.

### 3.2 Permissões (capacidades) por coleção

Ficam além do sandbox, que já isola o realm. Cada permissão liga ou desliga uma parte do `otto` dentro dos scripts:

| Permissão | API afetada | Padrão (`trusted` / `ask`) |
| --- | --- | --- |
| `sendRequests` | `otto.request('…')` com envio (`send` ≠ `never`) | on / **off** |
| `writeVariables` | `otto.environment.set/unset`, `otto.collectionVariables.set/unset` | on / on |
| `writeCookies` | `otto.cookies.set/remove/clear` | on / on |
| `readSecrets` | valores de variáveis `secret` em `otto.environment.get/all` e `otto.variables` (desligado = `'••••'`) | on / **off** |
| `modifyRequest` | `otto.request.set*` no pre-request | on / on |

Uma API desligada continua existindo, mas lança `Error("otto.environment.set is disabled by this collection's security policy (Security tab)")`. Assim o script falha com uma mensagem clara, em vez de `undefined is not a function`.

### 3.3 Impressão digital dos scripts (*fingerprint*)

- O main calcula um **inventário** de todos os scripts da coleção: `otto.yaml`, cada `_folder.yaml` e cada requisição, com fase, caminho e SHA-256 do código.
- O fingerprint é o SHA-256 da lista ordenada `(local, fase, hash)`.
- Ao confiar, o app guarda o fingerprint (`trusted_fingerprint`) e a data.
- Se o fingerprint atual for diferente, o estado efetivo vira **`changed`**: o modo continua `trusted`, mas o app volta a perguntar, mostrando **quais scripts mudaram**, e o indicador fica âmbar ("Scripts changed").
- Quem confia uma vez não passa a aceitar silenciosamente o que vier depois. Esse é o principal ganho de segurança deste plano.

### 3.4 Estado efetivo (`ScriptSecurityStatus`, derivado no renderer)

```
none        a coleção não tem scripts
trusted     modo trusted e fingerprint igual
changed     modo trusted, mas os scripts mudaram desde a confiança
ask         modo ask, sem decisão nesta sessão
session     modo ask, permitido até reiniciar
refused     modo ask, recusado nesta sessão
disabled    modo disabled
```

## 4. Indicador na `app-status-bar`

Aparece quando o contexto ativo (`TabsState.context()`) é uma coleção que **tem scripts**. Fica ao lado do indicador do mock server.

| Estado | Ícone / cor (tokens AA nos dois temas) | Texto curto | `aria-label` |
| --- | --- | --- | --- |
| `trusted` | `pi pi-shield`, verde 700/400 | `Scripts: trusted` | "Scripts of {coleção} are trusted. Open security settings" |
| `changed` | `pi pi-exclamation-triangle`, âmbar 800/300 | `Scripts changed` | "Scripts of {coleção} changed since they were trusted: review them. Open security settings" |
| `ask` | `pi pi-question-circle`, âmbar | `Scripts: ask` | "Otto asks before running scripts of {coleção}…" |
| `session` | `pi pi-clock`, azul 700/300 | `Scripts: allowed until restart` | … |
| `refused` / `disabled` | `pi pi-ban`, vermelho 700/400 | `Scripts: off` | … |

- **Atividade ao vivo:** enquanto um script roda, o ícone vira `pi-spin pi-spinner` e o texto mostra "Running pre-request…". Se o sandbox interromper um script (tempo, memória ou permissão negada), aparece um ponto vermelho até o próximo envio OK, e o tooltip traz o motivo ("Stopped: took longer than 3 s").
- **Clique** abre a página da coleção na aba **Security**. Um **menu de contexto** (botão direito ou `Shift+F10`) oferece as ações rápidas: *Trust*, *Ask before running*, *Disable scripts* e *Forget session decision*.
- **Acessibilidade:** é um `button` com `aria-label` completo. A mudança de estado é anunciada pelo `aria-live="polite"` que já existe na barra (sem anunciar cada execução, só interrupções). O texto curto some em larguras pequenas, e o ícone mantém o rótulo.
- **Comando:** novo `collection.security` ("Open collection security") no catálogo de atalhos e na paleta de comandos.

```
[⚙][☾] ● Mock :4010  🛡 Scripts: trusted                         0.1.1-beta.1
[⚙][☾]               ⚠ Scripts changed (3)                       0.1.1-beta.1
```

## 5. Aba **Security** na página da coleção

Nova `p-tab value="security"`, depois de **Scripts**. Ela tem um contador/ponto quando o estado é `changed`, como a aba OpenAPI faz com atualizações. Componente `features/collection/collection-security.ts`, carregado por `@defer` como as demais.

```
┌ Security ───────────────────────────────────────────────────────────────┐
│ Script mode                                                             │
│ ( ) Trusted            Runs without asking while the scripts don't change│
│ (•) Ask before running Asks once per session                            │
│ ( ) Scripts disabled   Requests are sent without running any script     │
│                                                                         │
│ Status: ⚠ 3 scripts changed since you trusted them on 2026-10-30        │
│         [Review changes]  [Trust current scripts]                       │
│ This session: allowed until restart            [Forget decision]        │
├─────────────────────────────────────────────────────────────────────────┤
│ Permissions (what scripts may do)                                        │
│ [x] Change the request being sent (otto.request.set…)                   │
│ [x] Write environment and collection variables                          │
│ [ ] Send other requests of the collection (otto.request('…'))           │
│ [ ] Read secret variables (otherwise they read as ••••)                 │
│ [x] Change cookies                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│ Scripts in this collection (7)                         Filter [______]  │
│  Where              Phase          Uses                       Status    │
│  Collection         pre-request    variables(write)           ✓         │
│  folder auth        pre-request    send requests, secrets     ⚠ changed │
│  auth/login.yaml    post-response  variables(write)           + new     │
│  …                                              [Open] on each row      │
├─────────────────────────────────────────────────────────────────────────┤
│ Sandbox                                                                  │
│ QuickJS (WebAssembly), isolated from the app. Memory 64 MB · 3 s per    │
│ step · 10 s CPU per script · no network, timers or DOM.                 │
├─────────────────────────────────────────────────────────────────────────┤
│ Recent activity (this session)                                           │
│ 14:02  auth/login  pre-request   12 ms   ok                             │
│ 14:03  users/list  pre-request   3.0 s   stopped: took too long          │
│ 14:05  users/list  pre-request   —       blocked: sendRequests is off    │
└─────────────────────────────────────────────────────────────────────────┘
```

Detalhes:
- **Modo:** `p-radiobutton` com rótulo e descrição (grupo com `role="radiogroup"` e `aria-describedby`). Trocar para *Trusted* pede confirmação, que mostra o inventário resumido ("7 scripts, 2 send requests, 1 reads secrets"). Trocar para *Disabled* aplica direto.
- **Revisar mudanças:** abre um diálogo com o `DiffView` (`shared/diff-view.ts`) por script alterado (versão confiada × atual). Para isso o main guarda o **snapshot** dos scripts confiados (§6.1), e não só o hash. Novos scripts aparecem inteiros; removidos aparecem riscados.
- **Inventário:** tabela (`p-table`, cabeçalhos `scope="col"`) com local, fase, tamanho, **o que usa** e estado (`✓` / `changed` / `new`). "O que usa" vem de uma análise estática com o parser lezer já usado em `script-policy.ts`: chamadas `otto.request(`, `.environment.set`, `.cookies.set`, leitura de variáveis marcadas como secretas. Ela é indicativa e não substitui as permissões: o texto diz isso ("detected statically; permissions are enforced at run time"). Os avisos atuais do editor (globais que não existem) também aparecem aqui. O botão *Open* leva à aba Scripts da coleção, à Folder Settings ou à aba Pre-request/Post-response da requisição.
- **Atividade recente:** buffer em memória (últimas 50 execuções da coleção), alimentado pelo `ScriptRunner`. Não vai para o disco, seguindo a mesma decisão do histórico.
- **Aba Scripts:** o aviso atual vira uma linha curta com link "Security settings →", para não duplicar controles.

## 6. Mudanças técnicas

### 6.1 Processo main

- **Migração 007** (`collections_metadata`):
  - `script_mode TEXT NOT NULL DEFAULT 'ask' CHECK (script_mode IN ('trusted','ask','disabled'))`, preenchida a partir de `scripts_trusted` (1 → `trusted`, 0 → `ask`).
  - `script_permissions TEXT` (JSON; `NULL` = padrão do modo).
  - `trusted_fingerprint TEXT`, `trusted_at TEXT`.
  - Tabela `trusted_scripts (collection_id, location, phase, code, PRIMARY KEY …, FK ON DELETE CASCADE)` com o snapshot para o diff.
  - A coluna `scripts_trusted` deixa de ser usada (o SQLite não remove coluna com CHECK sem recriar a tabela; ela fica como legado).
  - Coleções que já eram confiáveis guardam o fingerprint atual na primeira carga após a migração, para não perguntar de novo a quem já confiou.
- **Modelo** (`shared/models/collection.ts`): `CollectionMetadata.scriptPolicy: { mode; permissions; trustedFingerprint; trustedAt }` substitui `scriptsTrusted`. Novo `ScriptInventory { fingerprint; entries: Array<{ location: 'collection' | 'folder' | 'request'; path; phase; hash; size }> }`.
- **`CollectionService.scriptInventory(id)`**: reusa `requests()`, o manifesto e a leitura dos `_folder.yaml`, e calcula os hashes com `node:crypto`. Fica em cache por coleção e é invalidado no `emitChanged`/watcher.
- **IPC:**
  - `collections:script-inventory (id) → ScriptInventory`
  - `collections:set-script-policy (id, { mode, permissions })`: validado em `core/validation`. Ao ir para `trusted`, o main calcula o fingerprint e o snapshot **ele mesmo**; o renderer nunca envia o fingerprint, então não consegue "confiar" num conteúdo diferente do que está no disco.
  - `collections:trusted-scripts (id) → snapshot` (para o diff).
  - `collections:set-scripts-trusted` deixa de existir (substituído).
- O evento `collections:changed` já existente basta para o renderer recalcular o estado depois de um `git pull`.

### 6.2 Renderer

- **`ScriptPolicyState`** (substitui `ScriptTrust`, em `core/scripting/`), com:
  - `status(collectionId)`, um signal `computed` com o estado efetivo §3.4;
  - `inventory(collectionId)`, um `resource` que recarrega em `collections:changed`;
  - decisões de sessão em `signal<Map>` (agora visíveis);
  - `activity(collectionId)`, o buffer da §5;
  - `allowed(collectionId)`, que retorna `{ run: boolean; permissions }`. Ele pergunta quando o estado é `ask` ou `changed`; no caso `changed` o diálogo mostra a lista de alterados e o botão *Review changes*.
- **`ScriptRunner`:** recebe `permissions` e embrulha as APIs bloqueadas (§3.2) antes de passá-las ao sandbox. Registra cada execução no `activity` com duração, resultado e motivo.
- **`script-sandbox.ts`:** `ScriptError` ganha `reason: 'timeout' | 'memory' | 'error' | 'never-settles'`, para o indicador e a atividade não dependerem do texto da mensagem.
- **Componentes novos:**
  - `shell/script-security-indicator.ts`: indicador da status bar, pequeno e com responsabilidade única;
  - `features/collection/collection-security.ts`: a aba;
  - `features/collection/script-changes-dialog.ts`: o diff.
- **`ConfirmState`:** o diálogo de confiança passa a ter o link "Review scripts…", que abre a aba Security.

## 7. Fases

1. **Modelo e main:** migração 007, inventário com fingerprint e snapshot, novos canais IPC, validação.
2. **Estado no renderer:** `ScriptPolicyState`, permissões no `ScriptRunner`, `reason` no `ScriptError`, atividade. O comportamento passa a respeitar `changed`.
3. **Indicador na status bar**, com menu de ações rápidas e o comando `collection.security`.
4. **Aba Security:** modo, permissões, inventário, sandbox, atividade. Simplificar o aviso da aba Scripts.
5. **Diálogo de revisão** (diff confiado × atual).
6. **Verificação e docs:** cenários novos no `npm run audit:a11y`, que são o indicador em cada estado, a aba Security e o diálogo de diff, nos temas claro e escuro. Atualizar `PROGRESS.md`, o README (seção "Segurança dos scripts") e este plano.

As fases 1 e 2 já fecham a brecha da §2. As fases 3 a 5 são a parte visual pedida e podem ser entregues separadamente.

## 8. Roteiro de verificação (no app real, sem testes unitários novos)

- Coleção criada no app: o indicador mostra **trusted**. Alterar um script fora do app (editor/git) leva a **Scripts changed (1)**, e o envio pergunta, mostrando o diff. *Trust current scripts* volta para **trusted**.
- Coleção importada: o indicador mostra **ask**. *Allow Until Restart* leva a **session**, e reiniciar volta para **ask**.
- *Scripts disabled*: o envio sai sem rodar scripts e o console registra que foram pulados.
- Permissão `sendRequests` desligada: `otto.request('login', { send: 'always' })` falha com a mensagem da política, a atividade mostra "blocked", e o indicador mostra o ponto vermelho.
- `readSecrets` desligado: `otto.environment.get('token')` retorna `'••••'`.
- Loop infinito: atividade com "stopped: took too long" e tooltip do indicador com o motivo.
- O renderer não consegue gravar um fingerprint arbitrário (o canal não aceita o campo).
- `npm run lint`, `typecheck`, `build`, `test:electron` (expectativa das migrações inclui a 007) e `audit:a11y` sem violações.

## 9. Decisões em aberto

- **D1.** Em `disabled`: enviar sem scripts (proposto) ou bloquear o envio?
- **D2.** Os padrões de permissão para `ask` estão certos (`sendRequests` e `readSecrets` desligados)? Ou todas ligadas, deixando o controle só para o modo?
- **D3.** Limites do sandbox configuráveis por coleção (ex.: aumentar o tempo de um script pesado) ou só exibidos? Proposta: só exibidos agora, com um ajuste global em Preferences depois.
- **D4.** O indicador deve aparecer também em coleções **sem scripts** (como "No scripts", em cinza), ou ficar oculto (proposto)?
- **D5.** Pastas com política própria (ex.: só a pasta `admin/` desabilitada)? Proposta: não; a política é da coleção inteira, para continuar simples de revisar.
