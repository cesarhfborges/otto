# Plano: sandbox para scripts de usuário (pre-request / post-response)

## Contexto

Hoje os scripts rodam com `new AsyncFunction(...)` no renderer
(`src/app/core/scripting/script-runner.ts:185`), no mesmo realm do Angular e do
`window.otto` (ponte IPC do preload). A proteção é só a blocklist sintática de
`src/app/core/scripting/script-policy.ts`, que pode ser contornada.

### Brechas que a leitura do código indica (ainda não reproduzidas)

| # | Vetor | Exemplo |
|---|---|---|
| 1 | Chave computada até o construtor | `(async()=>{})['con'+'structor']('return window.otto')()` |
| 2 | `Reflect` / `Object` não bloqueados | `Reflect.get(fn, 'constructor')`, `Object.getPrototypeOf` |
| 3 | `setTimeout` com string (eval global) | `setTimeout('window.otto.settings.set({...})')` |
| 4 | Poluição de protótipo persistente | `Array.prototype.map = ...` |
| 5 | DoS sem timeout | `while (true) {}` congela a UI |
| 6 | Entrada via coleção/workspace importado ou repositório git | o script roda no "Send", sem aviso |

Impacto: acesso total ao `window.otto` (arquivos, workspaces, settings, proxy,
certificados, `http.send`) e exfiltração de variáveis `secret`.

O que **já está bem configurado**: `contextIsolation`, `nodeIntegration: false` e
`sandbox: true` nas janelas, o iframe `sandbox=""` do preview de HTML e o
interpretador de templates `{{ }}` sem eval (`electron/shared/templating/evaluate.ts`).

## Decisão

Executar os scripts no **QuickJS compilado para WASM** (`quickjs-emscripten`),
dentro de um **Web Worker** dedicado.

- QuickJS: realm totalmente separado, sem `window`, `fetch` nem DOM. Só existe o
  que for injetado. Tem limite de memória e interrupt handler para o timeout.
- Worker: tira a execução da thread da UI, e `worker.terminate()` é a garantia
  final caso o interrupt falhe.
- Descartados: o `vm` do Node (não é fronteira de segurança); um Worker puro
  (expõe `fetch`/`WebSocket` e o realm do browser); um iframe sandbox (mais
  frágil e com o mesmo custo de RPC).

## Arquitetura

```
ScriptRunner (renderer, Angular)
  └─ ScriptSandbox (service) ── postMessage ──► script.worker.ts
                                                 └─ QuickJS runtime/context (1 por execução)
                                                    ├─ otto.* (stubs → RPC para o host)
                                                    └─ console.*  (buffer de logs)
```

Protocolo (tipado, em `src/app/core/scripting/sandbox-protocol.ts`):

- host → worker: `{ type: 'run', id, code, snapshot, limits }`
  - `snapshot`: dados **serializáveis** de que o script precisa de forma síncrona,
    isto é, a requisição atual, a resposta, os valores de environment, coleção e
    pastas, e a identidade.
- worker → host: `{ type: 'call', id, callId, method, args }` para operações
  assíncronas ou do host (`otto.request('…')`, funções do `createOtto`, como
  cookies e uuid se dependerem do host).
- host → worker: `{ type: 'result', callId, value | error }`
- worker → host: `{ type: 'done', id, mutations, logs, error }`
  - `mutations`: o estado final de `request`, `environment` e `collectionVariables`
    (o host aplica e grava, como hoje nas linhas 191-202).

Princípio: **o host nunca recebe código nem objetos vivos**, só JSON validado.
Os métodos RPC ficam numa allowlist explícita no host.

## Etapas

### 1. Dependência e worker
- `npm i quickjs-emscripten` (variante `@jitl/quickjs-wasmfile-release-sync`) e
  fixar a versão.
- Criar `src/app/core/scripting/script.worker.ts` (o builder do Angular já
  suporta `new Worker(new URL('./script.worker', import.meta.url), { type: 'module' })`).
- Garantir que o `.wasm` vá para o build (`angular.json` assets, ou o import
  `?url` do pacote) e que carregue em `file://` e no Electron empacotado.

### 2. Runtime no worker
- Um `QuickJSRuntime` por execução, com:
  - `runtime.setMemoryLimit(32 * 1024 * 1024)`
  - `runtime.setMaxStackSize(512 * 1024)`
  - `runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs))`
- Injetar `otto` e `console` como handles QuickJS:
  - leituras síncronas (`otto.request.url`, `otto.response.json()`,
    `otto.environment.get`…) respondidas a partir do `snapshot`, dentro do worker;
  - setters (`setUrl`, `setHeader`, `environment.set`…) que alteram a cópia local
    (portar `variableStore` e `upsert` para um módulo puro compartilhado);
  - assíncronos (`otto.request('…')`, os helpers do `createOtto` que acessam o
    host) que viram promises do QuickJS resolvidas via RPC
    (`context.newPromise()` + `runtime.executePendingJobs()`).
- Rodar o código como `(async () => { "use strict"; ${code} })()`, aguardar a
  promise e então devolver `done`.
- Sempre fazer `dispose()` do context e do runtime (`try/finally`).

### 3. `ScriptSandbox` (host)
- `@Service` novo em `src/app/core/scripting/script-sandbox.ts`.
- Criar o worker sob demanda e reaproveitá-lo; recriar depois de `terminate`.
- Timeout duro: `setTimeout(() => worker.terminate(), timeoutMs + 1000)`, que
  rejeita com "script timed out".
- Despachar as `call` para uma allowlist (`request`, `cookies`…) que delega para o
  `TemplateContextService`. Validar os argumentos (string, tamanho máximo) e
  limitar o número de chamadas por execução (por exemplo, 50).
- Limitar o tamanho dos logs e das `mutations`.

### 4. Integrar no `ScriptRunner`
- `run()` monta o `snapshot`, chama `ScriptSandbox.execute`, aplica as `mutations`
  e mantém a gravação das variáveis e o formato de `ScriptOutcome` (o
  `responses.state.ts` não muda).
- Remover o `AsyncFunction` e os `SHADOWED_GLOBALS`.
- `script-policy.ts`: manter o `checkScript` **só** como diagnóstico no editor
  (`script-editor.ts`) e deixar de usá-lo como barreira. Atualizar o comentário.

### 5. Confiança em coleções importadas
- Flag `trustedScripts` por coleção (no SQLite do app, **não** no YAML da coleção,
  para que um repositório não consiga se autoconfiar).
- Ao executar o script de uma coleção não confiável, mostrar um diálogo
  ("Esta coleção contém scripts. Executar?" com as opções Confiar / Uma vez /
  Não), acessível e com foco gerenciado.
- Coleções criadas localmente nascem confiáveis. As importadas (archive,
  workspace, pasta aberta) nascem não confiáveis.

### 6. Endurecer o renderer
- Remover `ELECTRON_DISABLE_SECURITY_WARNINGS` (`electron/main/main.ts:10`).
- Definir o CSP via `session.webRequest.onHeadersReceived` ou um `<meta>` no `index.html`:
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
  connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  frame-src 'self' about:`
  (ajustar ao que o PrimeNG e o CodeMirror precisarem, mas **sem `'unsafe-eval'`**).
- Conferir se nada no app usa `eval`/`new Function` (o grep feito hoje só achou o
  script-runner).

### 7. Defesa em profundidade no main (IPC)
- Revisar os handlers que recebem caminhos (`workspaces:export/import`,
  `collections:export/import`, `workspaces:move-all`, `collection-files:*`):
  aceitar só os caminhos devolvidos por diálogos do main (token de uso único) ou
  dentro da pasta base ou da coleção, com `path.resolve` e checagem de prefixo.
- Garantir que `http:send` não leia certificados ou arquivos de caminhos
  arbitrários vindos de dados da coleção sem confirmação.

### 8. Verificação (sem testes unitários, conforme combinado)
- `npm run build` e o typecheck do Electron.
- No app, confirmar manualmente que:
  - os scripts existentes continuam funcionando (`setHeader`, `environment.set`,
    `otto.request('…').response`, `console.log` na timeline);
  - os payloads 1 a 5 da tabela falham sem efeito (sem acesso a `window.otto`,
    `setTimeout` inexistente, protótipos do app intactos e `while(true)` encerrado
    pelo timeout com a UI responsiva);
  - uma coleção importada com script mostra o diálogo de confiança;
  - não há violações de CSP no console durante o uso normal.

## Riscos e notas

- **Compatibilidade de API**: `setTimeout`, `Promise` com timers e `structuredClone`
  deixam de existir no script. Documentar e, se necessário, oferecer um
  `otto.sleep(ms)` via RPC.
- **Performance**: carregar o WASM tem custo (cerca de 1 MB, alguns ms). Fazer o
  preload do worker no startup do app.
- **Tamanho do snapshot**: respostas grandes. Enviar o body uma vez e fazer o
  parse sob demanda dentro do worker.
- Atualizar `docs/PROGRESS.md` ao concluir cada etapa.
