# Plano de Implementação — Variáveis, Comandos e Inputs com Template

> Status: **proposta** (2026-10-21) — para leitura e refinamento. Nada implementado ainda.
> As decisões em aberto estão em §12; as recomendações já aparecem no texto.

## 1. Objetivo

1. Definir **uma sintaxe única** para variáveis e comandos (`{{$.NOME}}` e `{{ otto.… }}`), que sirva hoje nos campos da requisição e amanhã seja um subconjunto da API dos scripts (Pre-request / Post-request).
2. Permitir **apontar para atributos de outra requisição da mesma coleção** (corpo, header, status… da resposta ou da requisição), com política de reenvio — o equivalente ao `{% response … %}` do Insomnia.
3. Criar dois componentes reutilizáveis, **`app-otto-input`** e **`app-otto-textarea`**, que se comportam como `pInputText` / `pTextarea` (ngModel, formControl, Signal Forms, `value`, `placeholder`, `disabled`…), mas mostram variáveis/comandos como **chips** e têm **autocomplete** (`{{` ou `Ctrl+Space`, reservado do sistema, e logo que for colocado `{{` o input ou textarea ja colocará a direita `}}` fechando o elemento criando assim oi visual tipico da variavel/comando).

## 2. Situação atual (análise do código)

| Onde | O que faz | Impacto |
| --- | --- | --- |
| `electron/shared/http/interpolate.ts` | Regex `VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g`; `variablesFrom()` resolve referências entre variáveis (profundidade 5); `interpolateRequest()` substitui em URL, params, headers, auth e body (síncrono). | Será substituído por um **tokenizer/parser/avaliador** (assíncrono, por causa de requisições referenciadas). |
| `src/app/core/state/responses.state.ts` → `send()` | Pega o ambiente selecionado, junta headers da coleção, interpola, monta (`buildHttpRequest`) e envia. Erro `UNRESOLVED_VARIABLES` lista os nomes. | Vira o ponto de entrada do novo `TemplateEngine`; precisa ser reaproveitável para enviar requisições referenciadas. |
| `ResponsesState.entries` | Últimas 20 respostas **só em memória**, chave `collectionId:path`. | Insuficiente para `otto.collection.request(...).response` (some ao reiniciar). Precisa de persistência (§8). |
| `electron/shared/models/environment.ts` | Só existem **ambientes** (da coleção ou globais); um selecionado por coleção (`EnvironmentsState.selected`, em `localStorage`). | Não há variáveis de coleção, globais sempre ativas nem variáveis de execução. |
| `electron/shared/models/collection.ts` → `CollectionManifest` (`otto.yaml`) | Tem `headers`, não tem `variables`. | Lugar natural para **variáveis da coleção** (versionadas no Git). |
| `RequestDefinition` / `CollectionRequestNode` | Identificados **pelo caminho do arquivo**. | Referenciar por caminho quebra ao renomear/mover. Precisa de **`id` estável** no YAML (§7.2). |
| `src/app/features/request/body-format.ts` → `protectJsonVariables` | Varre `{{…}}` procurando o primeiro `}}`. | Deve usar o tokenizer novo (um comando pode ter `}}` dentro de string). |
| `electron/main/infra/openapi/openapi-converter.ts` / `openapi-exporter.ts` | Geram/leem `{{baseUrl}}`, `{{token}}`, `{{id}}`… | Passam a gerar `{{$.baseUrl}}`; o exporter precisa reconhecer as duas formas. |
| Campos de texto | `request-view.ts` (URL, `<input>` cru), `key-value-editor.ts` (`pInputText` com `[value]`/`(input)`), `auth-editor.ts`, `collection-headers.ts`, `environments-page.ts` (Reactive Forms), `code-editor.ts` (textarea + `<pre>` espelho para o corpo). | Alvos da troca pelos componentes novos (§10, fase 4). |
| `electron/shared/models/keybindings.ts` | Catálogo de comandos, `fixed: true` e `RESERVED_SHORTCUTS` (lista "Reserved by the system"). | `Ctrl+Space` entra como reservado. |
| `src/app/core/keyboard/keybinding.service.ts` | Escuta `keydown` no `document` em **captura**. | Não pode engolir `Ctrl+Space` antes do editor focado. |

## 3. Sintaxe e catálogo de comandos

### 3.1 Princípios

- **Uma delimitação só:** tudo dentro de `{{ … }}` — sem uma segunda sintaxe tipo `{% … %}`. O conteúdo é uma *expressão*.
- **Dois "começos" possíveis:** `$` (variáveis) e `otto` (comandos/objetos do sistema).
- **Subconjunto da API dos scripts:** o que funciona em `{{ otto.x.y(...) }}` funciona igual em JavaScript no Pre/Post-request (`otto.x.y(...)`). Quem aprende um, aprende o outro.
- **Sem `eval`:** templates são interpretados por um parser próprio (sem operadores, sem atribuição, sem efeitos colaterais além do "enviar requisição referenciada"). Transformações são feitas com **funções** (`otto.string.upper(…)`, `otto.default(…)`); lógica de verdade fica para os scripts.
- **Mesma leitura para requisição e resposta:** `get`, `text`, `json`, `header`, `cookie`… têm o mesmo nome e comportamento em `otto.request`, `otto.collection.request(…).request` e `….response` (§3.6).

### 3.2 Variáveis — `{{$.NOME}}`

```
{{$.base_url}}              → resolve pela cadeia de escopos (§4)
{{$.user.id}}               → acesso a propriedade quando o valor é JSON (opcional, ver §12)
{{$['nome com espaço']}}    → nomes fora do padrão
```

- Nome padrão: `[A-Za-z_][A-Za-z0-9_-]*`. Outros nomes, via `$['…']`.
- **Escopo explícito (opcional):** `{{$env.x}}`, `{{$collection.x}}`, `{{$globals.x}}` — pulam a cadeia. Decisão em §12.
- **Compatibilidade:** `{{baseUrl}}` (forma atual, sem `$.`) continua aceito como **alias legado** de `{{$.baseUrl}}`. O autocomplete sempre insere a forma nova.

### 3.3 Gramática

```
template := ( text | tag )*
tag      := "{{" ws expr ws "}}"
expr     := varRef | ottoExpr | legacyName
varRef   := "$" scope? ( "." ident | "[" string "]" ) access*
ottoExpr := "otto" access*
access   := "." ident | "[" ( string | number ) "]" | "(" args? ")"
args     := arg ( "," arg )*
arg      := string | number | boolean | null | object | array | varRef | ottoExpr
object   := "{" ( ident ":" arg ( "," ident ":" arg )* )? "}"
string   := '…' | "…"      (com escapes \' \" \\)
```

- Membros podem ser encadeados depois de chamadas: `….response.json().users[0].name` é válido e equivale a `….response.get('$.users[0].name')`.
- Literal `{{` no texto: `\{{` (decisão em §12).
- Erro de sintaxe dentro de um `{{ … }}` → o trecho vira chip **inválido** (vermelho) e o envio é bloqueado com mensagem clara.

### 3.4 Tipos e conversão para texto

Uma tag sempre vira **texto** no campo. Cada comando tem um tipo de retorno declarado no catálogo (§5); a conversão final segue esta regra:

| Tipo do resultado | Texto inserido | Exemplo |
| --- | --- | --- |
| `string` | Como está | `abc123` |
| `number` / `boolean` | `String(valor)` | `200`, `true` |
| `object` / `array` | JSON compacto | `{"id":1,"name":"Ana"}` |
| `Cookies` (`.cookies()`) | Formato do header `Cookie` | `session=abc123; theme=dark` |
| `Headers` (`.headers()`) | JSON compacto `{ "nome": "valor" }` | `{"content-type":"application/json"}` |
| `Message` (`.response` / `.request` sozinhos) | Corpo como texto (igual a `.text()`) | |
| `null` | Texto vazio | |
| `undefined` (caminho/header/cookie inexistente) | **Não resolvido** → chip danger e envio bloqueado, exceto dentro de `otto.default(…)` / `otto.optional(…)` | |

Nos scripts os mesmos comandos devolvem os valores nativos (objeto, número, `Cookies`…); a conversão para texto só acontece nos templates.

### 3.5 Mapa do objeto `otto`

Coluna **Onde**: **T** = templates (inputs), **Pre** / **Post** = scripts (futuro, §3.12).

```
otto
├── request                      requisição atual ............................. T Pre Post
├── response                     resposta atual ............................... Post
├── collection
│   ├── name / id                                                    ........... T Pre Post
│   └── request(ref, opts?)      outra requisição da coleção (§3.8) ............ T Pre Post
├── environment / collectionVariables / globals / variables   (§3.12) ......... Pre Post
├── info                         contexto da execução (§3.9.10) ................ T Pre Post
├── uuid, nanoid, ulid           identificadores (§3.9.1) ...................... T Pre Post
├── now, date                    data/hora (§3.9.2) ............................ T Pre Post
├── random                       valores aleatórios e dados fake (§3.9.3) ...... T Pre Post
├── base64, base64url, url, hex, html   codificação (§3.9.4) ................... T Pre Post
├── hash, hmac                   criptografia (§3.9.5) ......................... T Pre Post
├── jwt                          tokens JWT (§3.9.6) ........................... T Pre Post
├── string                       transformação de texto (§3.9.7) ............... T Pre Post
├── json                         JSON (§3.9.8) ................................. T Pre Post
├── default, optional            fallback (§3.9.9) ............................. T Pre Post
├── process.env(name)            variável de ambiente do SO (§3.9.10) .......... T Pre Post
├── file                         arquivos locais (§3.9.11) ..................... T Pre Post
├── prompt(label, opts?)         pergunta ao usuário no envio (§3.9.12) ........ T Pre
├── sendRequest, test, expect    só scripts (§3.12) ............................ Pre Post
```

### 3.6 Leitura de mensagens (requisição e resposta)

Estes membros existem **igualmente** em:

- `otto.request` — requisição atual;
- `otto.collection.request(ref).request` — definição de outra requisição (já interpolada);
- `otto.collection.request(ref).response` — última resposta de outra requisição;
- `otto.response` — resposta atual (só Post-request).

#### 3.6.1 Corpo

| Membro | Retorno | O que faz |
| --- | --- | --- |
| `.get(path)` | `any` | Primeiro valor que casa com o caminho. `path` começando com `$` = **JSONPath**; com `/` = **XPath** (XML/HTML). |
| `.getAll(path)` | `array` | Todos os valores que casam (`'$.users[*].id'` → `[1,2,3]`). |
| `.has(path)` | `boolean` | Se o caminho existe. |
| `.count(path)` | `number` | Quantidade de valores que casam (ex.: `'$.items[*]'`). |
| `.text()` | `string` | Corpo inteiro como texto (UTF-8). |
| `.json()` | `object \| array` | Corpo como JSON. Aceita encadear: `.json().users[0].name`. Corpo não-JSON → erro "Body is not valid JSON". |
| `.body` | `string` | Atalho de `.text()` (propriedade, para quem vem do Postman). |
| `.bodyType` | `string` | `json`, `xml`, `text`, `form-urlencoded`, `multipart-form`, `binary`, `none` (na resposta, deduzido do `Content-Type`). |
| `.form(name)` | `string` | Campo de formulário (`form-urlencoded`/`multipart`, só texto). |
| `.forms()` | `object` | Todos os campos de formulário. |
| `.base64()` | `string` | Corpo em Base64 (útil para respostas binárias). |
| `.size` | `number` | Tamanho do corpo em bytes. |

Exemplos (`ref` = `'rq_8f3a2c'`):

```
{{ otto.collection.request('rq_8f3a2c').response.get('$.userName') }}
{{ otto.collection.request('rq_8f3a2c').response.get('$[0].userName') }}
{{ otto.collection.request('rq_8f3a2c').response.get('$.users[0].name') }}
{{ otto.collection.request('rq_8f3a2c').response.get('$.users[?(@.active)].email') }}
{{ otto.collection.request('rq_8f3a2c').response.getAll('$.users[*].id') }}      → [1,2,3]
{{ otto.collection.request('rq_8f3a2c').response.text() }}                      → corpo bruto
{{ otto.collection.request('rq_8f3a2c').response.json() }}                      → JSON compacto
{{ otto.collection.request('rq_8f3a2c').response.json().users[0].name }}
{{ otto.collection.request('rq_8f3a2c').response.get('/soap:Envelope/soap:Body/token') }}   (XML)
{{ otto.collection.request('rq_8f3a2c').request.get('$.username') }}             → do corpo enviado pelo Login
{{ otto.collection.request('rq_8f3a2c').request.form('grant_type') }}
{{ otto.request.get('$.order.id') }}                                             → corpo da requisição atual
```

JSONPath suportado (mínimo): `$`, `.campo`, `['campo']`, `[n]`, `[-1]`, `[*]`, `..campo` (busca recursiva), `[a,b]`, `[início:fim]`, filtros `[?(@.campo == 'x')]`, `[?(@.campo)]`.

#### 3.6.2 Headers

| Membro | Retorno | O que faz |
| --- | --- | --- |
| `.header(name)` | `string` | Valor do header (nome sem diferenciar maiúsculas). Se repetido, junta com `, ` (padrão HTTP); para `Set-Cookie` devolve **o primeiro** — use `.cookie()`. |
| `.headerAll(name)` | `array` | Todos os valores do header, sem juntar (ex.: vários `Set-Cookie`). |
| `.headers()` | `Headers` | Todos os headers. No template: JSON. No script: `.get`, `.has`, `.all`, `.toObject()`. |
| `.hasHeader(name)` | `boolean` | Se o header existe. |
| `.contentType` | `string` | `Content-Type` sem parâmetros (`application/json`). |

> Para isso, `last_responses` (§8) guarda os headers como **lista de pares** (com repetições), igual ao `HttpResult` atual — não como objeto.

#### 3.6.3 Cookies

Na **resposta**, os cookies vêm dos `Set-Cookie`; na **requisição**, do header `Cookie` enviado.

| Membro | Retorno | O que faz |
| --- | --- | --- |
| `.cookie(name)` | `string` | Só o **valor** do cookie (`abc123`). |
| `.cookies()` | `Cookies` | Todos. No template vira `session=abc123; theme=dark` (pronto para um header `Cookie`). No script: `.get(name)`, `.has(name)`, `.toObject()`, `.all()`. |
| `.cookieInfo(name)` | `object` | Detalhes de um `Set-Cookie`: `{ name, value, domain, path, expires, maxAge, httpOnly, secure, sameSite }` (só resposta). |
| `.cookieInfo(name).expires` | `string` | Exemplo de acesso a um atributo (ISO 8601). |
| `.hasCookie(name)` | `boolean` | Se o cookie existe. |

#### 3.6.4 Metadados

| Membro | Request | Response | Retorno | Observação |
| --- | --- | --- | --- | --- |
| `.url` | ✔ | ✔ | `string` | Na resposta: URL final (após redirecionamentos). |
| `.method` | ✔ | | `string` | |
| `.host` / `.pathname` / `.protocol` / `.port` | ✔ | ✔ | `string` | Partes da URL. |
| `.param(name)` / `.params()` | ✔ | | `string` / `object` | Query string (já interpolada). |
| `.auth.type` / `.auth.token` / `.auth.username` / `.auth.password` / `.auth.key` / `.auth.value` | ✔ | | `string` | Autenticação definida na requisição (valores secretos aparecem mascarados no preview). |
| `.status` / `.code` | | ✔ | `number` | `.code` é alias de `.status`. |
| `.statusText` | | ✔ | `string` | |
| `.ok` | | ✔ | `boolean` | Status 2xx. |
| `.time` | | ✔ | `number` | Tempo total (ms). |
| `.timings.ttfb` / `.timings.download` / `.timings.total` | | ✔ | `number` | Do `HttpResult.timings`. |
| `.receivedAt` | | ✔ | `string` | ISO 8601. |
| `.age` | | ✔ | `number` | Segundos desde o recebimento. |
| `.redirected` | | ✔ | `boolean` | |

### 3.7 Requisição atual — `otto.request`

Tem todos os membros de §3.6 com o estado **depois** da interpolação dos demais campos, mais:

| Membro | Retorno | O que faz |
| --- | --- | --- |
| `.id` / `.name` / `.path` / `.folder` | `string` | Identificação da requisição (id estável, nome, arquivo, pasta). |

Exemplos:

```
X-Trace      {{ otto.request.header('X-Request-Id') }}
X-Signature  {{ otto.hmac('sha256', $.secret, otto.request.text(), 'hex') }}
X-Order      {{ otto.request.get('$.order.id') }}
```

- Uma tag que lê o próprio campo onde está (ex.: `otto.request.header('Cookie')` dentro do header `Cookie`, ou `otto.request.text()` dentro do corpo) é **referência circular**: chip danger, envio bloqueado.
- Ordem de resolução: URL → params → headers → auth → corpo; leituras cruzadas são resolvidas sob demanda (com detecção de ciclo), então a ordem não limita o uso.

### 3.8 Outra requisição — `otto.collection.request(ref, opts?)`

```
otto.collection.request('rq_8f3a2c', { send: 'expired', maxAge: 600 })
    .request   → leitura da definição (§3.6), já interpolada no contexto dela
    .response  → leitura da última resposta (§3.6)
    .id / .name / .path / .folder / .method
    .hasResponse   → boolean
```

| Parte | Opções |
| --- | --- |
| `ref` | **`id` estável** da requisição (§7.2). O chip mostra o **nome** (`Auth › Login`), não o id. Aceita também caminho relativo (`'auth/login'`) como atalho — o editor converte para id ao salvar. |
| `send` | `'never'` (só usa a última resposta guardada) · `'empty'` (envia se não houver resposta) · `'expired'` (envia se mais velha que `maxAge` segundos) · `'always'` (envia sempre). Padrão: `'empty'`. |
| `maxAge` | Segundos; só com `send: 'expired'`. |
| `expect` | (opcional) status esperado, ex.: `{ expect: 200 }` ou `{ expect: '2xx' }`. Se a resposta (guardada ou nova) não bater, a tag falha com "Login returned 401" em vez de enviar lixo. |

Exemplos:

```
Authorization  Bearer {{ otto.collection.request('rq_8f3a2c', { send: 'expired', maxAge: 600, expect: '2xx' }).response.get('$.access_token') }}
Cookie         {{ otto.collection.request('rq_8f3a2c').response.cookies() }}
X-Session      {{ otto.collection.request('rq_8f3a2c').response.cookie('session') }}
X-Location     {{ otto.collection.request('rq_8f3a2c', { send: 'never' }).response.header('Location') }}
X-Tenant       {{ otto.collection.request('rq_8f3a2c').request.header('X-Tenant') }}
/users/{{ otto.collection.request('rq_list').response.get('$[0].id') }}
```

> O texto parece longo, mas o usuário quase nunca o digita: o autocomplete (§9.5) e o **editor do chip** (§9.4) montam a expressão, e o chip exibe só `Login › get $.access_token`.

### 3.9 Funções utilitárias

#### 3.9.1 Identificadores

| Comando | Exemplo de saída |
| --- | --- |
| `otto.uuid()` / `otto.uuid('v4')` | `3b241101-e2bb-4255-8caf-4136c566a962` |
| `otto.uuid('v7')` | UUID ordenável por tempo |
| `otto.nanoid(size?)` | `V1StGXR8_Z5jdHi6B-myT` |
| `otto.ulid()` | `01ARZ3NDEKTSV4RRFFQ69G5FAV` |

#### 3.9.2 Data e hora

| Comando | Exemplo de saída |
| --- | --- |
| `otto.now()` | ISO 8601: `2026-10-21T14:03:12.511Z` |
| `otto.now('unix')` / `otto.now('unixMs')` | `1792591392` / `1792591392511` |
| `otto.now('YYYY-MM-DD HH:mm:ss')` | Formato com tokens (`YYYY MM DD HH mm ss SSS Z`) |
| `otto.now(format, { tz: 'America/Sao_Paulo' })` | Com fuso (via `Intl`) |
| `otto.date.add('1d', format?)` | Agora + duração (`30s`, `15m`, `2h`, `1d`, `1w`, `-1M`, `1y`) |
| `otto.date.format(valor, format)` | Reformatar data recebida (ex.: de uma resposta) |
| `otto.date.parse(valor, 'unix')` | Converter para outro formato |

#### 3.9.3 Aleatórios e dados fake

| Comando | Saída |
| --- | --- |
| `otto.random.int(min, max)` | Inteiro no intervalo |
| `otto.random.float(min, max, casas?)` | Decimal |
| `otto.random.boolean()` | `true`/`false` |
| `otto.random.string(tamanho, charset?)` | `charset`: `'alpha'`, `'alnum'`, `'numeric'`, `'hex'` ou caracteres literais |
| `otto.random.hex(tamanho)` | Hexadecimal |
| `otto.random.pick(a, b, c…)` | Um dos valores |
| `otto.random.email()` / `.name()` / `.firstName()` / `.lastName()` / `.username()` | Dados fake simples (listas embutidas, offline) |
| `otto.random.phone()` | Telefone BR formatado |
| `otto.random.cpf(formatado?)` / `otto.random.cnpj(formatado?)` | Documento **válido** (dígitos verificadores) |
| `otto.random.date(início?, fim?, format?)` | Data no intervalo |

#### 3.9.4 Codificação

| Comando | O que faz |
| --- | --- |
| `otto.base64(v)` / `otto.base64.decode(v)` | Base64 (UTF-8, mesma função do `build-request.ts`) |
| `otto.base64url(v)` / `otto.base64url.decode(v)` | Base64 URL-safe, sem padding |
| `otto.url.encode(v)` / `otto.url.decode(v)` | `encodeURIComponent` / `decodeURIComponent` |
| `otto.url.query(objeto)` | `{ a: 1, b: 'x' }` → `a=1&b=x` |
| `otto.hex(v)` / `otto.hex.decode(v)` | Hexadecimal |
| `otto.html.escape(v)` / `otto.html.unescape(v)` | Entidades HTML/XML (útil em corpo SOAP) |

#### 3.9.5 Criptografia

| Comando | O que faz |
| --- | --- |
| `otto.hash(alg, v, enc?)` | `alg`: `md5`, `sha1`, `sha256`, `sha384`, `sha512`; `enc`: `'hex'` (padrão) ou `'base64'` |
| `otto.hmac(alg, chave, v, enc?)` | HMAC (assinatura de webhooks/APIs) |

`sha*`/`hmac` via `crypto.subtle` (assíncrono — o avaliador já é assíncrono). `md5` não existe no `crypto.subtle`: implementação pequena própria (§12).

#### 3.9.6 JWT

| Comando | O que faz |
| --- | --- |
| `otto.jwt.decode(token)` | `{ header, payload }` (sem validar assinatura) |
| `otto.jwt.claim(token, nome)` | Um claim do payload (`sub`, `exp`…) |
| `otto.jwt.expiresIn(token)` | Segundos até expirar (negativo = expirado) |
| `otto.jwt.sign(payload, segredo, alg?)` | Gera token `HS256`/`HS384`/`HS512` (útil para mocks e APIs internas) |

Reenviar o Login só quando o token expirar exige uma comparação (`expiresIn(...) > 0`). Templates não têm operadores, então esse caso fica para o Pre-request. Nos templates, use `send: 'expired'` com um `maxAge` menor que a validade do token.

#### 3.9.7 Texto — `otto.string`

`upper(v)`, `lower(v)`, `trim(v)`, `capitalize(v)`, `slug(v)`, `replace(v, de, para)` (todas as ocorrências), `regex(v, padrão, grupo?)` (extrai um trecho), `substring(v, início, fim?)`, `padStart(v, tamanho, char)`, `padEnd(v, tamanho, char)`, `split(v, separador, índice)`, `join(array, separador)`, `length(v)`, `repeat(v, n)`, `concat(a, b, …)`.

```
{{ otto.string.upper($.country) }}
{{ otto.string.regex(otto.collection.request('rq_login').response.header('Location'), 'code=([^&]+)', 1) }}
```

#### 3.9.8 JSON — `otto.json`

| Comando | O que faz |
| --- | --- |
| `otto.json.get(valor, path)` | JSONPath sobre um valor qualquer (ex.: uma variável com JSON) |
| `otto.json.stringify(valor, indent?)` | Serializar (com indentação opcional) |
| `otto.json.parse(texto)` | Converter texto em objeto (para encadear) |
| `otto.json.escape(v)` | Escapa para colocar **dentro** de uma string JSON (aspas, quebras de linha) |

`otto.json.escape` é importante no corpo JSON: `"bio": "{{ otto.json.escape($.bio) }}"`.

#### 3.9.9 Fallback

| Comando | O que faz |
| --- | --- |
| `otto.default(expr, fallback)` | Se `expr` não resolver (variável inexistente, caminho ausente, requisição sem resposta), usa `fallback`. Chip continua **primary**. |
| `otto.optional(expr)` | Igual a `otto.default(expr, '')`. |
| `otto.coalesce(a, b, c…)` | Primeiro valor resolvido e não vazio. |

```
{{ otto.default($.tenant, 'acme') }}
{{ otto.coalesce($.token, otto.collection.request('rq_login', { send: 'never' }).response.get('$.access_token')) }}
```

#### 3.9.10 Contexto e sistema

| Comando | O que faz |
| --- | --- |
| `otto.info.environment` | Nome do ambiente selecionado |
| `otto.info.collection` / `otto.collection.name` | Nome da coleção |
| `otto.info.workspace` | Nome do workspace |
| `otto.info.app.version` / `otto.info.platform` | Versão do Otto / `linux`, `win32`, `darwin` |
| `otto.process.env(nome)` | Variável de ambiente do sistema operacional (ex.: segredo exportado no shell). Lida no main via IPC; **lista de permissões** configurável em Preferences (§12). |

#### 3.9.11 Arquivos — `otto.file`

| Comando | O que faz |
| --- | --- |
| `otto.file.text(caminho)` | Conteúdo de um arquivo local como texto |
| `otto.file.base64(caminho)` | Conteúdo em Base64 |
| `otto.file.json(caminho)` | Conteúdo como JSON (encadeável) |

Leitura feita no main via IPC; caminho relativo = relativo à **pasta da coleção** (portável no Git). Fora da coleção exige confirmação (§12).

#### 3.9.12 Prompt — `otto.prompt(label, opts?)`

Abre um diálogo no envio pedindo o valor (ex.: código OTP). `opts`: `{ secret: true, default: '…', remember: 'session' }`. No preview, o chip mostra `Prompt: OTP code` sem pedir nada.

### 3.10 Equivalências com o Insomnia

| Insomnia | Otto |
| --- | --- |
| `{{ _.base_url }}` | `{{$.base_url}}` |
| `{% response 'body', 'req_x', 'b64::JC50b2tlbg==::46b', 'when-expired', 60 %}` | `{{ otto.collection.request('rq_x', { send: 'expired', maxAge: 60 }).response.get('$.token') }}` |
| `{% response 'header', 'req_x', 'Location', 'never' %}` | `{{ otto.collection.request('rq_x', { send: 'never' }).response.header('Location') }}` |
| `{% response 'raw', 'req_x', '', 'no-history' %}` | `{{ otto.collection.request('rq_x').response.text() }}` |
| `{% response 'url', 'req_x' %}` | `{{ otto.collection.request('rq_x').response.url }}` |
| `{% request 'header', 'X-Trace', 0 %}` | `{{ otto.request.header('X-Trace') }}` |
| `{% request 'cookie', 'session', 0 %}` | `{{ otto.request.cookie('session') }}` |
| `{% uuid 'v4' %}` | `{{ otto.uuid() }}` |
| `{% now 'iso-8601' %}` | `{{ otto.now() }}` |
| `{% base64 'encode', 'normal', 'x' %}` | `{{ otto.base64('x') }}` |
| `{% hash 'sha256', 'hex', 'x' %}` | `{{ otto.hash('sha256', 'x') }}` |
| `{% prompt 'OTP', '', '', '', true %}` | `{{ otto.prompt('OTP', { secret: true }) }}` |

### 3.11 Exemplos completos

| Caso | Campo | Valor |
| --- | --- | --- |
| Bearer token do Login | Auth → Bearer → Token | `{{ otto.collection.request('rq_login', { send: 'expired', maxAge: 3000 }).response.get('$.access_token') }}` |
| Sessão por cookie | Header `Cookie` | `{{ otto.collection.request('rq_login').response.cookies() }}` |
| Id do primeiro usuário | URL | `{{$.base_url}}/users/{{ otto.collection.request('rq_list_users').response.get('$[0].id') }}` |
| Reaproveitar o corpo do Login | Corpo JSON | `{ "user": "{{ otto.collection.request('rq_login').request.get('$.username') }}" }` |
| Assinatura de webhook | Header `X-Signature` | `sha256={{ otto.hmac('sha256', $.webhook_secret, otto.request.text()) }}` |
| Idempotência | Header `Idempotency-Key` | `{{ otto.uuid() }}` |
| Data de amanhã | Param `date` | `{{ otto.date.add('1d', 'YYYY-MM-DD') }}` |
| Massa de teste | Corpo JSON | `{ "cpf": "{{ otto.random.cpf() }}", "email": "{{ otto.random.email() }}" }` |

### 3.12 API dos scripts (futuro — Pre-request / Post-request)

Mesmo objeto `otto`, agora em JavaScript real, com leitura **e escrita**. Todos os comandos de §3.6–§3.9 existem com o mesmo nome; abaixo, o que é **exclusivo** dos scripts:

```js
// variáveis (cada escopo com get / set / has / unset / clear / toObject)
otto.environment.has('token');         otto.environment.set('token', value);
otto.collectionVariables.get('tenant');
otto.globals.set('x', 1);
otto.variables.get('token');           // cadeia de escopos, igual a {{$.token}}
otto.variables.set('tmp', 1);          // escopo de execução (só neste envio/run)
otto.variables.resolve('{{$.base_url}}/users');   // interpola um template

// requisição atual (mutável no Pre-request)
otto.request.url = '…'; otto.request.method = 'POST';
otto.request.headers.upsert('X-Trace', otto.uuid());
otto.request.headers.remove('X-Debug');
otto.request.params.set('page', 2);
otto.request.body.json = { … };        // ou .text = '…'

// resposta atual (Post-request) — mesma leitura de §3.6
otto.response.code; otto.response.get('$.id'); otto.response.json(); otto.response.cookie('session');

// outras requisições
const login = otto.collection.request('rq_8f3a2c');
if (!login.hasResponse || login.response.age > 600) await login.send();
otto.request.headers.upsert('Authorization', `Bearer ${login.response.get('$.access_token')}`);

await otto.sendRequest({ url: '…', method: 'GET' });   // requisição avulsa

// testes e log (fase posterior)
otto.test('status 200', () => otto.expect(otto.response.code).toBe(200));
console.log('...');   // vai para a aba Console da resposta
```

Regra de ouro: **todo nome usado em template existe com o mesmo significado no script.** O catálogo é declarado uma vez (`catalog.ts`, §5) e alimenta parser, autocomplete, documentação do chip e, no futuro, os tipos (`.d.ts`) do editor de scripts.

## 4. Escopos de variáveis e precedência

Do mais específico para o mais geral (o primeiro que tiver o nome vence):

| # | Escopo | Onde vive | Versionado no Git | Escrita por script |
| --- | --- | --- | --- | --- |
| 1 | **Execução** (`otto.variables.set`) | Memória, por envio/run | Não | Sim |
| 2 | **Ambiente** selecionado | SQLite (já existe) | Não (secretos ficam fora) | Sim |
| 3 | **Coleção** | `otto.yaml` → `variables` | **Sim** | Sim (grava o arquivo — ver §12) |
| 4 | **Globais** do workspace | SQLite (novo: "ambiente global sempre ativo") | Não | Sim |

- Hoje um ambiente global pode ser *selecionado* para a coleção — isso continua (ocupa o escopo 2). O escopo 4 é novo e opcional (§12).
- Variáveis podem referenciar outras (`base_url = {{$.host}}/v1`) e conter comandos (`session = {{ otto.collection.request('rq_login').response.cookie('session') }}`) — a resolução recursiva atual (`MAX_DEPTH = 5`) é mantida, agora com **detecção de ciclo** e mensagem explícita.
- Secretos: o chip mostra `••••`; o valor real só aparece com ação explícita (olho) no popover.

## 5. Arquitetura do motor de templates

Código puro em `electron/shared/templating/` (roda no renderer hoje e no main/sandbox de scripts amanhã):

| Arquivo | Responsabilidade |
| --- | --- |
| `tokenize.ts` | Divide o texto em `TextSegment` e `TagSegment { start, end, raw }`, respeitando strings dentro da tag. Usado pelo editor (chips), pelo `body-format.ts` e pelo avaliador. **Síncrono e rápido** (roda a cada tecla). |
| `parse.ts` | `raw` → AST (`VarRef`, `OttoExpr` com cadeia de `Member`/`Index`/`Call`, literais). Erros com posição. |
| `ast.ts` | Tipos do AST + `describe(ast)` → rótulo curto do chip (`Login › get $.access_token`). |
| `catalog.ts` | **Catálogo declarativo** do `otto` (§3.5–§3.9): nome, assinatura, parâmetros (com fonte de sugestões), descrição, exemplo, tipo de retorno, onde vale (T/Pre/Post), se é `async`, se pode enviar requisição, se precisa de IPC. Alimenta validação, autocomplete e documentação. |
| `evaluate.ts` | `evaluate(ast, ctx): Promise<unknown>` — percorre o AST chamando o catálogo/`TemplateContext`. |
| `serialize.ts` | Conversão do resultado para texto (§3.4). |
| `context.ts` | Interface `TemplateContext` (injetada): `variable(name, scope?)`, `currentRequest()`, `requestRef(ref, opts)`, `env(name)`, `readFile(path)`, `prompt(label, opts)`, `now()`, `random()`… |
| `message-reader.ts` | Implementação única de §3.6 (`get`, `getAll`, `text`, `json`, `header`, `headerAll`, `headers`, `cookie`, `cookies`, `cookieInfo`, metadados) sobre um `MessageSnapshot` (definição interpolada **ou** resposta guardada). |
| `cookies.ts` | Parser de `Set-Cookie` / `Cookie` e tipo `Cookies` com `toString()` no formato de header. |
| `jsonpath.ts` / `xpath.ts` | Extração no corpo. JSONPath: subset de §3.6.1 (implementação própria ou dependência leve, §12). XPath: `DOMParser` + `document.evaluate` no renderer. |
| `functions/*.ts` | Utilitários de §3.9 (`ids`, `date`, `random`, `fake`, `encoding`, `crypto`, `jwt`, `string`, `json`, `fallback`), cada um registrado no catálogo. |
| `interpolate.ts` (reescrito) | `interpolateRequest(definition, ctx)` assíncrono; mantém o retorno `{ definition, unresolved, errors }`. |

No Angular:

- `src/app/core/templating/template-context.service.ts` — implementa `TemplateContext` com `EnvironmentsState`, `CollectionsState`, a store de últimas respostas, o envio de requisições referenciadas e os IPCs (`process.env`, `file`).
- `src/app/core/templating/request-runner.ts` — extrai de `ResponsesState.send` o pipeline "interpolar → montar → enviar → guardar resposta", reaproveitado para enviar requisições referenciadas (com **pilha de chamadas** para detectar ciclos A→B→A e limite de profundidade).
- **Modo preview:** o mesmo avaliador com `ctx.preview = true` nunca envia nada nem abre `prompt` (usa só cache) — usado nos tooltips/popovers dos chips e no autocomplete. Funções não determinísticas (`uuid`, `random.*`, `now`) mostram um **exemplo** no preview, marcado como "gerado no envio".

> Quando os scripts chegarem, o pipeline (`request-runner`) deve migrar para o **main** (ou um `utilityProcess`) junto com o sandbox de JS; por isso o motor fica em `electron/shared/`, sem dependência de Angular.

## 6. Componentes `app-otto-input` e `app-otto-textarea`

### 6.1 Abordagem técnica (recomendação: CodeMirror 6)

| Opção | Prós | Contras |
| --- | --- | --- |
| **A. CodeMirror 6** (`@codemirror/state`, `view`, `autocomplete`, `commands`) — **recomendada** | Chips de verdade (`Decoration.replace` + widget com rótulo diferente do texto), faixas **atômicas** (cursor pula o chip, Backspace apaga inteiro), autocomplete pronto e acessível (`role="listbox"`, `aria-activedescendant`), `Ctrl+Space` nativo (`startCompletion`), undo/redo, IME, colar. Mesmo motor serve para o corpo JSON e para o editor de scripts futuro. | Nova dependência (~120–150 kB gz com os pacotes usados); exige *wrapper* cuidadoso para parecer `pInputText`. |
| B. `<input>`/`<textarea>` real + camada espelho (como o `code-editor.ts` atual) | Zero dependência; ngModel/undo/a11y nativos. | O chip **não pode** ter largura diferente do texto: impossível mostrar `Login › get` no lugar de `otto.collection.request('rq_…')…`. Exclusão atômica e clique no chip viram gambiarra. |
| C. `contenteditable` próprio | Controle total. | Reimplementar caret, seleção, IME, undo, colar — alto risco. |

### 6.2 API pública (igual para os dois, salvo onde indicado)

```html
<app-otto-input [(ngModel)]="url" placeholder="https://…" ariaLabel="Request URL" size="small" />
<app-otto-input [formControl]="ctrl" />
<app-otto-input [field]="form.url" />                 <!-- Signal Forms -->
<app-otto-input [(value)]="url" (enter)="send()" />   <!-- signals puros -->
<app-otto-textarea [(ngModel)]="text" [rows]="5" [autoResize]="true" />
```

| Membro | Tipo | Observação |
| --- | --- | --- |
| `value` | `model<string>('')` | Texto bruto (com `{{…}}`). Também implementa `FormValueControl<string>` (Signal Forms). |
| `ControlValueAccessor` | `NG_VALUE_ACCESSOR` | `ngModel` / `formControl` / `formControlName`; `onTouched` no blur. |
| `disabled`, `readonly` | `input<boolean>` | `disabled` também via `setDisabledState`. |
| `placeholder` | `input<string>` | |
| `invalid` | `input<boolean>` | Visual de erro igual ao PrimeNG (`p-invalid`) + `aria-invalid`. |
| `size` | `'small' \| 'large' \| undefined` | Espelha `pSize`. |
| `variant` | `'outlined' \| 'filled'` | Espelha PrimeNG. |
| `fluid` | `input<boolean>` | Largura 100%. |
| `inputId`, `ariaLabel`, `ariaLabelledBy`, `ariaDescribedBy` | `input<string \| null>` | Aplicados no elemento editável (`contentAttributes` do CM). |
| `type` (só input) | `'text' \| 'password'` | `password` mascara o **texto**, mas mantém os chips visíveis (útil em Auth). |
| `rows`, `autoResize` (só textarea) | `number`, `boolean` | Como `pTextarea`. |
| `monospace` | `input<boolean>` (padrão `true`) | URL/headers usam mono; descrições não. |
| `suggestions` | `input<TemplateScope \| null>` | Contexto do autocomplete (coleção/requisição atuais **e o campo**, para detectar auto-referência); por padrão vem de um `TemplateScope` provido pela página (DI). |
| `enter` (só input) | `output<KeyboardEvent>` | Single-line: `Enter` não insere quebra; emite `enter` e **propaga** o evento para o `form[appEnterSubmit]` continuar funcionando. Com a lista do autocomplete aberta, `Enter` aceita a sugestão e **não** propaga. |
| `focus` / `blur` | `output<FocusEvent>` | |
| `focus()` / `select()` | métodos públicos | Paridade com `HTMLInputElement` (o `KeyValueEditor.add()` foca a nova linha). |

Comportamento de input single-line: colar texto com quebras de linha → substitui por espaço; altura fixa; rolagem horizontal.

### 6.3 Visual dos chips

Só **dois estados de cor**, sempre a partir das variáveis CSS que o projeto já usa. Não há cores fixas no componente.

| Estado | Quando | Cor | Ícone |
| --- | --- | --- | --- |
| **Correto** | Variável existe na cadeia de escopos; comando `otto.*` válido no catálogo; requisição referenciada existe | **primary** do app (`--p-primary-*`) | `pi-at` (variável), `pi-lock` (secreta), `pi-bolt` (comando), `pi-link` (requisição) |
| **Incorreto** | Variável não definida em nenhum escopo; comando desconhecido; argumentos inválidos; erro de sintaxe; requisição referenciada inexistente; ciclo entre variáveis | **danger/error** do app (`--p-red-*`, a mesma família que o preset usa em `message.error` e `button.danger`) | `pi-exclamation-triangle` |

#### Tokens

Os tokens ficam em `src/assets/styles.scss`, ao lado dos `--otto-method-*`, e seguem o mesmo padrão: `:root` para o tema claro e `:root.app-dark` para o escuro (`darkModeSelector: '.app-dark'`). O componente usa **apenas** estes `--otto-template-*`, que por sua vez apontam para as variáveis do PrimeNG/preset. Assim, trocar a cor primária em Preferences → Appearance (`PrimaryColor`) muda os chips na hora.

```scss
:root {
    /* Chips de variável/comando: correto = primary do app; incorreto = danger (red) do app. */
    --otto-template-ok-color: var(--p-primary-700);
    --otto-template-ok-background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
    --otto-template-ok-border: color-mix(in srgb, var(--p-primary-color) 45%, transparent);

    --otto-template-error-color: var(--p-red-700);
    --otto-template-error-background: color-mix(in srgb, var(--p-red-500) 12%, transparent);
    --otto-template-error-border: var(--p-red-400);
}

:root.app-dark {
    --otto-template-ok-color: var(--p-primary-300);
    --otto-template-ok-background: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
    --otto-template-ok-border: color-mix(in srgb, var(--p-primary-color) 50%, transparent);

    --otto-template-error-color: var(--p-red-300);
    --otto-template-error-background: color-mix(in srgb, var(--p-red-400) 18%, transparent);
    --otto-template-error-border: var(--p-red-400);
}
```

- **Texto em tom 700 (claro) e 300 (escuro)**, e não em `--p-primary-color` (500): o tom 500 sobre fundo claro não passa de 4.5:1 em várias cores primárias (ex.: amber, yellow, lime). É o mesmo critério que o `otto-preset.ts` já aplica em `button.danger` e `message.error` (`red.700`). Fundo e borda continuam derivados do `--p-primary-color` / `--p-red-*`.
- **Validar o contraste para cada `PrimaryColor`** oferecido em Appearance. Se algum tom falhar, ajustar só o token `--otto-template-ok-color` dessa paleta, nunca no componente.

#### Aparência do chip

```scss
.otto-template-chip {
    color: var(--otto-template-ok-color);
    background: var(--otto-template-ok-background);
    border: 1px solid var(--otto-template-ok-border);
    border-radius: var(--p-inputtext-border-radius);
    padding: 0 0.25rem;
    font-family: inherit;   /* mono no input de URL/headers */
}

.otto-template-chip[data-state='error'] {
    color: var(--otto-template-error-color);
    background: var(--otto-template-error-background);
    border: 1px dashed var(--otto-template-error-border);
}
```

- O estado vem do **tokenizer + modo preview** (§5), atualizado com *debounce* a cada edição e quando o ambiente selecionado ou as variáveis da coleção mudam. Exemplo: um chip vermelho fica azul assim que a variável é criada.
- Com o cursor dentro de uma tag, o texto fica sem chip (texto bruto editável); o chip aparece quando o cursor sai da tag.
- **A cor nunca é o único sinal** (WCAG 1.4.1): o estado incorreto também tem ícone, borda tracejada, `aria-invalid` no chip e o motivo no tooltip/`aria-label` (ex.: "Variable base_url is not defined in Dev"). Se houver pelo menos um chip incorreto, o campo inteiro também ganha `aria-invalid="true"` e a borda de erro do PrimeNG (`--p-inputtext-invalid-border-color`), como num `pInputText` inválido.
- Contraste **≥ 4.5:1** do texto do chip sobre o fundo do input nos temas claro e escuro. O foco do chip usa o anel padrão do app (`outline: 2px solid var(--p-primary-color)`).

#### Rótulos dos chips (`describe(ast)`)

| Expressão | Rótulo |
| --- | --- |
| `$.base_url` | `base_url` |
| `otto.collection.request('rq_8f3a2c').response.get('$.userName')` | `Login › get $.userName` |
| `….response.cookie('session')` | `Login › cookie session` |
| `….response.cookies()` | `Login › cookies` |
| `….response.header('Location')` | `Login › header Location` |
| `….response.text()` / `.json()` | `Login › text` / `Login › json` |
| `….request.get('$.username')` | `Login › request get $.username` |
| `otto.request.header('X-Trace')` | `Request › header X-Trace` |
| `otto.uuid()` | `uuid()` |
| `otto.hmac('sha256', $.secret, otto.request.text())` | `hmac sha256` |

## 7. Mudanças no modelo de dados

### 7.1 Variáveis da coleção — `otto.yaml`

```yaml
version: 1            # continua 1: campo novo e opcional
name: Minha API
headers: []
variables:
  - { key: tenant, value: acme, enabled: true, description: "Tenant padrão" }
```

- `CollectionManifest.variables: KeyValue[]` (+ `CollectionManifestPatch`), validação em `electron/main/core/validation/collections.ts`, leitura/escrita em `yaml-collection-format.ts`.
- Nova aba **Variables** em `collection-overview.ts` (reaproveita `KeyValueEditor`).

### 7.2 `id` estável da requisição

- `RequestDefinition.id?: string` (ex.: `rq_` + 10 caracteres base36), gravado no YAML da requisição.
- Gerado ao criar, importar (OpenAPI/backup) e, para arquivos antigos, **na primeira gravação** (sem reescrever a coleção inteira).
- `CollectionRequestNode.id: string | null` — o `fs-collection-store` já lê o arquivo para pegar `method`/`name`; passa a pegar o `id`.
- `CollectionsState` ganha índice `id → path` (e detecta **ids duplicados** — ex.: arquivo copiado à mão — avisando e regenerando no próximo save da cópia).
- `HttpRequestSource` ganha `requestId`.

### 7.3 Globais do workspace (se aprovado em §12)

- Reaproveitar `environments` com uma flag/ambiente especial "Globals" (`collectionId = null`, `kind = 'globals'`), migração `004`.

## 8. Últimas respostas persistidas

Necessário para `send: 'never' | 'empty' | 'expired'` sobreviver a reinícios e para o autocomplete sugerir caminhos JSON, headers e cookies.

- Migração SQLite `004-last-responses.ts`: tabela `last_responses (collection_id, request_id, status, status_text, headers_json, body BLOB, content_type, size, time_ms, timings_json, url, redirected, received_at)`, PK `(collection_id, request_id)`, corpo limitado (ex.: 2 MB; acima disso guarda truncado e marca).
- `headers_json` é uma **lista de pares** `[nome, valor][]` (mantém `Set-Cookie` repetidos — §3.6.2).
- Guardar também o **snapshot da requisição enviada** (URL final, headers e corpo interpolados) para `….request.*` refletir o que foi de fato enviado quando a definição tiver valores gerados no envio (`uuid`, `now`).
- Gravação no main, no `history-recording-executor.ts` (já intercepta todos os envios com `source`).
- IPC `responses:last(collectionId, requestId)` + `ResponsesGateway` no renderer.
- Reaproveitar também para mostrar a última resposta ao reabrir a aba (bônus).

## 9. Autocomplete e edição de chips

### 9.1 Gatilhos

- Digitar `{{` → insere `}}` de fechamento, põe o cursor no meio (`{{ | }}`) e abre a lista.
- `Ctrl+Space` (em **todas** as plataformas — `Cmd+Space` é do Spotlight):
  - **fora de uma tag** → insere `{{  }}`, põe o cursor no meio e abre a lista;
  - **dentro de uma tag** → abre a lista para o trecho onde está o cursor.
- `Esc` com a tag ainda vazia remove o `{{  }}` inserido.
- Digitar dentro de uma tag (`{{$.ba|`) → filtra; após `.` ou `(` → sugere membros/argumentos do catálogo (§9.5).

### 9.2 Fontes de sugestão (ordem)

1. Variáveis da cadeia de escopos — nome, **escopo** (badge), valor resolvido (secretos mascarados); sombreadas aparecem riscadas ("sobrescrita por Environment").
2. Comandos `otto.*` do catálogo — assinatura + descrição, filtrados pelo contexto (só os marcados com **T**).
3. Atalhos prontos (só na tag vazia): **"Response from another request…"** abre direto o popover editor (§9.4).
4. Depois de `otto.collection.request(` → requisições da coleção (método + nome + pasta), inserindo o **id**.
5. Argumentos com fonte de dados (declarada no catálogo), a partir da **última resposta/definição** da requisição referenciada:
   - `.get('` / `.getAll('` / `.has('` / `.count('` → caminhos JSON (`$.access_token`, `$.users[0].name`…) ou XPath;
   - `.header('` / `.headerAll('` / `.hasHeader('` → headers;
   - `.cookie('` / `.cookieInfo('` / `.hasCookie('` → cookies;
   - `.param('` → query params; `.form('` → campos de formulário;
   - `otto.hash('` / `otto.hmac('` → algoritmos; `otto.now('` → formatos;
   - `{ send: '` → `never`, `empty`, `expired`, `always`.

### 9.3 Atalho reservado `Ctrl+Space`

- Entrada em `RESERVED_SHORTCUTS` (`electron/shared/models/keybindings.ts`): `{ label: 'Show variable suggestions', keys: ['Ctrl+Space'] }` — aparece em "Reserved by the system" e nenhum comando configurável pode usá-lo.
- `keybinding.service.ts` (captura no `document`): não tratar/`preventDefault` em `Ctrl+Space`; o editor focado trata via keymap do CodeMirror.
- Sem editor de template focado, `Ctrl+Space` não faz nada (não bloqueia o padrão).

### 9.4 Interação com o chip

- **Hover/foco** → tooltip com valor resolvido (modo preview) e escopo de origem.
- **Clique, `Enter` ou `F2`** com o cursor encostado no chip → **popover editor** (`p-popover`, foco preso, `Escape` fecha e devolve o foco):
  - Variável: nome (com autocomplete), escopo, valor atual, link "Editar em Environments / Collection".
  - Requisição referenciada: *select* da requisição; alvo (`response` / `request`); leitura (`get`, `getAll`, `text`, `json`, `header`, `headers`, `cookie`, `cookies`, `status`, `url`, `time`…); argumento (caminho JSONPath/XPath com **árvore clicável do JSON da última resposta**, nome do header/cookie); política `send`, `maxAge` e `expect`; **pré-visualização ao vivo**.
  - Comandos utilitários: formulário gerado a partir dos parâmetros do catálogo (ex.: `hmac` → algoritmo, chave, valor, encoding).
  - Qualquer chip: aba "Expressão" com o texto bruto editável.
- `Backspace`/`Delete` apagam o chip inteiro; `Ctrl+Z` desfaz.
- Leitor de tela: o widget expõe `aria-label` descritivo ("Variable base_url, value https://…"); o campo inteiro continua um `textbox`.

### 9.5 Comportamento do autocomplete

**Lista inicial** (tag vazia, após `{{` ou `Ctrl+Space`):

```
{{ | }}
┌────────────────────────────────────────────────────────┐
│ VARIABLES                                              │
│  @  $.base_url      Environment · https://api.acme.dev │
│  @  $.tenant        Collection  · acme                 │
│  🔒 $.api_key       Environment · ••••                 │
│ COMMANDS                                               │
│  ▸  otto            Otto commands and request data     │
│ SHORTCUTS                                              │
│  🔗 Response from another request…                     │
└────────────────────────────────────────────────────────┘
```

**Digitando `otto.`** — ao digitar `o`, `ot`, `ott` a lista filtra (busca aproximada); o `.` aceita `otto` e recarrega com os membros dele:

```
{{ otto.| }}
┌──────────────────────────────────────────────────────────────────┐
│  ▸  collection        namespace  Requests of this collection     │
│  ▸  request           object     The request being sent          │
│  ▸  info              object     Environment, collection, app    │
│  ƒ  uuid(version?)    string     Random UUID                     │
│  ƒ  now(format?)      string     Current date/time               │
│  ▸  date              namespace  Date math and formatting        │
│  ▸  random            namespace  Random values and fake data     │
│  ƒ  base64(value)     string     Base64 encode                   │
│  ƒ  hash(alg, value)  string     md5 / sha1 / sha256 / sha512    │
│  ƒ  hmac(alg, key, v) string     HMAC signature                  │
│  ▸  jwt               namespace  Decode / sign JWT               │
│  ▸  string            namespace  Text transformations            │
│  ▸  json              namespace  JSON helpers                    │
│  ƒ  default(v, alt)   any        Fallback when v is unresolved   │
│  …                                                               │
└──────────────────────────────────────────────────────────────────┘
  ┌ Painel lateral do item focado ─────────────────────┐
  │ otto.request                                       │
  │ The request being sent. Read-only in templates.    │
  │ Example: {{ otto.request.header('X-Trace') }}      │
  └────────────────────────────────────────────────────┘
```

- **Sensível ao contexto:** nos templates não aparecem `otto.response` (a resposta atual não existe no envio), `otto.environment`, `otto.variables` e afins (lá a forma única é `{{$.x}}`), `sendRequest`, `test`, `expect`. No editor de scripts, o mesmo catálogo mostra tudo que vale para Pre ou Post.
- `▸` = objeto/namespace (aceitar insere `.` e reabre a lista); `ƒ` = função (aceitar insere `()` com o cursor dentro).

**Digitando `otto.request.`** — membros da requisição **atual**, com valor em preview:

```
{{ otto.request.| }}
┌────────────────────────────────────────────────────────────────┐
│  ·  url             string   https://api.acme.dev/v1/profile   │
│  ·  method          string   GET                               │
│  ·  name            string   Get profile                       │
│  ƒ  header(name)    string   Header of this request            │
│  ƒ  headers()       Headers  All headers                       │
│  ƒ  cookie(name)    string   Cookie sent by this request       │
│  ƒ  param(name)     string   Query parameter                   │
│  ƒ  get(path)       any      Body value (JSONPath / XPath)     │
│  ƒ  text()          string   Body as text                      │
│  ƒ  json()          object   Body as JSON                      │
│  ▸  auth            object   Authentication                    │
│  …                                                             │
└────────────────────────────────────────────────────────────────┘
```

Ao aceitar `header(name)`: vira `{{ otto.request.header('|') }}`, aparece a dica de assinatura `header(name: string) → string` e a lista mostra os headers desta requisição (com valores). Ao escolher `X-Tenant`, o cursor pula para depois do `)` e a lista fecha.

**Digitando `otto.collection.request('rq_8f3a2c').response.get('`** — a lista mostra os caminhos do JSON da última resposta do Login, com o valor de cada um:

```
{{ otto.collection.request('rq_8f3a2c').response.get('|') }}
  get(path: string) → any        Login · 200 · received 4 min ago
┌───────────────────────────────────────────────────────┐
│  $.access_token        "eyJhbGciOi…"                  │
│  $.expires_in          3600                           │
│  $.user                {…}                            │
│  $.user.id             42                             │
│  $.user.name           "Ana"                          │
│  $.users[0].name       "Ana"                          │
└───────────────────────────────────────────────────────┘
```

Sem resposta guardada, a lista mostra *"Login has no response yet — send it to get suggestions"* com a ação **Send Login** (envio explícito, nunca automático no preview).

**Regras gerais:**

| Você digita / faz | Resultado |
| --- | --- |
| Letras | Filtra a lista atual (busca aproximada). |
| `.` após um objeto válido | Aceita o item e lista os membros dele. |
| `(` ou aceitar uma função | Insere `()` (ou `('')` quando o 1º parâmetro é string), mostra a assinatura e sugere os **valores possíveis do argumento** (§9.2, item 5). |
| `,` dentro dos parênteses | Passa para o próximo argumento, com nova dica e novas sugestões (ex.: `{ send, maxAge, expect }`). |
| Aceitar item final / `)` | Fecha a lista; o cursor fica dentro da tag. |
| `↑` `↓` / `PageUp` `PageDown` | Navegam. |
| `Enter` / `Tab` | Aceitam o item focado. |
| `Esc` | Fecha a lista. Se a tag estiver vazia, remove o `{{  }}`. |
| Cursor sai da tag | O texto vira **chip** (primary ou danger). |
| Cursor volta ao chip (setas, `Enter`, `F2`) | Mostra o texto bruto para edição; `Ctrl+Space` reabre a lista. |
| Membro inexistente (`otto.xyz`) | Lista mostra *"No matches"*; ao sair, chip **danger**. |
| Auto-referência (`otto.request.header('Cookie')` no próprio header `Cookie`) | Item aparece desabilitado com o aviso *"Circular reference"*; se digitado, chip **danger**. |

**Acessibilidade:** lista `role="listbox"` com `aria-activedescendant`; região `aria-live` anuncia *"7 suggestions"* e o item focado com o tipo (*"request, object"*); o painel lateral é associado por `aria-describedby`.

## 10. Fases

| Fase | Entrega | Principais arquivos |
| --- | --- | --- |
| **1. Motor** | `tokenize`/`parse`/`ast`/`catalog`/`evaluate`/`serialize` em `electron/shared/templating/`; alias legado `{{nome}}`; `interpolateRequest` assíncrono; `ResponsesState.send` usa o motor; funções puras de §3.9.1–§3.9.9 (ids, data, random/fake, codificação, crypto, jwt, string, json, fallback); `body-format.ts` usa o tokenizer. | `electron/shared/templating/*`, `electron/shared/http/interpolate.ts`, `responses.state.ts`, `body-format.ts` |
| **2. Escopos** | Variáveis da coleção no `otto.yaml` + aba Variables; cadeia de precedência; detecção de ciclo; mensagens de erro novas (com escopo). Globais (se aprovado). | `collection.ts`, validação/yaml de coleções, `collection-overview.ts`, `environments.state.ts` |
| **3. Componentes** | `app-otto-input` e `app-otto-textarea` (CodeMirror 6, CVA + Signal Forms, chips, tooltip), autocomplete de variáveis/comandos (§9.5), `Ctrl+Space` reservado. | `src/app/shared/template-editor/*`, `keybindings.ts`, `keybinding.service.ts`, `src/assets/styles.scss` (tokens `--otto-template-*`, §6.3) |
| **4. Adoção** | Trocar campos: URL (`request-view.ts`), `KeyValueEditor` (nome e valor), `auth-editor.ts`, `collection-headers.ts`, valores em `environments-page.ts`; textarea nos corpos `text`/form. Corpo JSON/XML (`code-editor.ts`): migrar para CodeMirror com highlight + chips numa sub-fase. | arquivos citados |
| **5. Leitura de mensagens e referências** | `id` estável (§7.2); `last_responses` (§8); `otto.request` com leitura de §3.6; `otto.collection.request(...)` com `send`/`maxAge`/`expect`; `message-reader`, `cookies`, JSONPath/XPath; popover editor; autocomplete de requisições, caminhos, headers e cookies; detecção de ciclos e auto-referência. | `request.ts`, `fs-collection-store.ts`, `collections.state.ts`, migração `004`, `history-recording-executor.ts`, `request-runner.ts`, `message-reader.ts` |
| **6. Comandos com IPC** | `otto.process.env` (com lista de permissões), `otto.file.*`, `otto.prompt`, `otto.info.*`. | novos IPCs + `template-context.service.ts` |
| **7. Migração/compat** | OpenAPI converter gera `{{$.x}}`; exporter entende as duas formas; ação opcional "Atualizar sintaxe das variáveis" na coleção. | `openapi-converter.ts`, `openapi-exporter.ts` |
| **8. Scripts (futuro)** | Abas Pre-request / Post-request; sandbox JS; objeto `otto` completo (§3.12) gerado do mesmo `catalog.ts`; `console.log` na aba Console; `otto.test`. Pipeline de envio migra para o main. | novo plano dedicado |

Verificação por fase: `npm run typecheck`, `npm run build` e conferência no app (sem testes unitários novos, conforme combinado).

## 11. Riscos

- **Envio em cascata**: uma URL com `send: 'always'` dispara outra requisição a cada envio — deixar visível no Console da resposta ("Sent Auth › Login because of {{…}}").
- **Preview com efeitos**: tooltips/autocomplete **nunca** enviam requisições, abrem `prompt` ou leem arquivos fora da coleção (modo preview).
- **Auto-referência nos headers da coleção**: um header de coleção que referencia a requisição Login também é enviado **pelo próprio Login** → ciclo. O editor de headers da coleção avisa ("This header also applies to Auth › Login, which it references") e sugere desabilitar o header no Login ou mover a expressão para uma variável.
- **Segredos expostos**: `otto.process.env`, `otto.file` e `….request.auth.*` podem vazar segredos para outra requisição ou para o histórico — lista de permissões, preview mascarado e confirmação na primeira leitura.
- **Performance**: tokenizar a cada tecla é barato; avaliar (preview) deve ser *debounced* e cacheado por texto; JSONPath sobre respostas grandes (até 2 MB) só no envio ou sob demanda no autocomplete.
- **Arquivos antigos sem `id`**: referências por caminho continuam funcionando até a primeira gravação.
- **Conflito de nomes legados**: variáveis com nomes como `otto` ou começando com `$` — o alias legado só vale para nomes `[A-Za-z_][\w-]*` diferentes de `otto`.

## 12. Decisões em aberto

1. **CodeMirror 6** como base dos componentes (recomendado) ou espelho sem dependência (sem rótulos amigáveis nos chips)?
2. **Escopos explícitos** `{{$env.x}}` / `{{$collection.x}}` / `{{$globals.x}}`: incluir já ou só `{{$.x}}`?
3. **Globais do workspace** sempre ativas (escopo 4): criar agora ou deixar para os scripts?
4. **Referência**: `otto.collection.request(ref)` (recomendado, espelha o script) ou um atalho mais curto, ex.: `otto.ref(ref)` / `otto.req(ref)`?
5. **Padrão de `send`**: `'empty'` (recomendado) ou `'never'` como no Insomnia?
6. **Escape de `{{` literal**: `\{{` (recomendado) ou `{{'{{'}}`?
7. **Acesso a propriedades** em variáveis com valor JSON (`{{$.user.id}}`): suportar?
8. **JSONPath**: implementação própria (subset de §3.6.1) ou dependência (`jsonpath-plus`, ~10 kB)?
9. **Scripts que escrevem em variáveis de coleção** (`otto.collectionVariables.set`): gravar no `otto.yaml` (muda arquivo versionado) ou só em memória até o usuário salvar?
10. **Migração da sintaxe**: manter `{{nome}}` para sempre como alias ou oferecer conversão e marcar como obsoleto?
11. **`.body`** como alias de `.text()`: manter (familiar para quem vem do Postman) ou ter só `.text()`?
12. **`md5`**: incluir (implementação própria, ~2 kB; usado por APIs legadas) ou só `sha*`?
13. **`otto.process.env` e `otto.file`**: liberar por padrão, exigir lista de permissões em Preferences ou confirmar na primeira leitura de cada nome/arquivo?
14. **Dados fake** (`otto.random.name/email/cpf/cnpj…`): listas embutidas em pt-BR, en-US ou ambas (configurável)?
