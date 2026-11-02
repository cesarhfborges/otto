# Plano de correções dos problemas conhecidos

> Status: **em andamento**. Proposta em 2026-11-02; #3 implementado em 2026-11-02.
> Fonte dos problemas: [ANALISE_PROBLEMAS.md](ANALISE_PROBLEMAS.md), revisada contra o código em 2026-11-02, e a seção "Pendências e débitos conhecidos" do [PROGRESS.md](PROGRESS.md).
> Os números entre parênteses (ex.: **#2**) são os itens da análise.

## 1. Objetivo e escopo

Corrigir os 15 problemas ainda abertos da análise, mais 3 débitos de robustez e segurança registrados só no `PROGRESS.md`.

As fases vão da maior para a menor gravidade. Cada fase pode ser entregue e verificada sozinha.

Fica **fora** deste plano o que é funcionalidade nova, não defeito:
- importar do Postman e do Insomnia;
- `otto.folderVariables.set`;
- guardar no disco as respostas usadas no encadeamento;
- separar DNS, TCP e TLS nas métricas;
- aplicar o Prettier no repositório.

Esses itens continuam listados no `PROGRESS.md`.

**Verificação de cada fase:** `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:electron` (os testes que já existem precisam continuar passando; não serão escritos testes novos), `npm run audit:a11y` quando houver UI nova, e os cenários manuais da fase rodados no app real.

---

## 2. Fase 1: perda de dados no renderer

Itens **#1** (o que falta), **#13**, **#14**, **#21**, **#2** e a parte de gravação concorrente do **#9**.

### 2.1 Infraestrutura em `RequestDraftsState` e `TabsState`
- **`RequestDraftsState.dirtyIn(collectionId?)`:** devolve as chaves sujas, todas ou só as de uma coleção.
- **`RequestDraftsState.confirmDiscard(scope)`:** extraído do `QuitGuardState`, que passa a usá-lo. Monta a mensagem com os títulos das abas (a lógica que hoje está no `QuitGuardState`) e usa `ConfirmState.choose` com três saídas:
  - **Save All:** grava com `saveAll` filtrado pelo escopo. Se alguma gravação falhar, mostra o erro e cancela a ação.
  - **Discard:** descarta.
  - **Cancel:** não faz nada.

  Retorna `true` quando a ação pode seguir.
- **`RequestDraftsState.forget(collectionId, prefix?)`:** remove os rascunhos da coleção inteira ou de um caminho e do que há dentro dele.
- **Gravação única por chave (#9):** `RequestDraftsState.save` guarda um `Map<string, Promise<void>>`. Uma segunda chamada para a mesma chave espera a gravação em andamento e só grava de novo se o rascunho ainda estiver diferente do salvo.
- **Fechamento pendente (#21):** `TabsState.close` mantém um `Set` de IDs que estão fechando e ignora chamadas repetidas enquanto o aviso está aberto. O mesmo vale para os fechamentos em lote.
- **`TabsState.discard(predicate)`:** remove abas sem passar pelo guard. Serve para os fluxos que já confirmaram antes.

### 2.2 Fluxos
| Fluxo | Mudança |
| ----- | ------- |
| Trocar de workspace (`WorkspacesState.activate`) | `confirmDiscard('all')` antes do `flush`. Se cancelado, não troca. Depois de trocar, `forget` dos rascunhos do workspace anterior. |
| Remover workspace ativo (`WorkspacesState.remove`) | Igual ao anterior, quando o workspace for o ativo. |
| Remover coleção (`RemoveCollectionDialog.run`) (#1, #13) | `confirmDiscard({ collectionId })` depois da escolha "Remove"/"Remove and Delete Files". Se confirmado, executa `trash`/`close`. **Só depois do sucesso**: `tabs.discard` das abas da coleção, `drafts.forget` e `responses.forget` (da fase 3). Se a operação falhar, abas e rascunhos ficam como estavam. |
| Excluir request ou pasta na sidebar (#14) | Uma única confirmação. Se houver rascunhos sujos no alvo, a mensagem diz isso ("…and discard unsaved changes in 2 requests"). Depois de excluir: `tabs.discard`, `drafts.forget` e `responses.forget`, sem o guard. |

### 2.3 Conflito com o disco (#2)
- **Sinal de conflito:** `DraftEntry` ganha `external: RequestDefinition | null`. Em `loaded()`, com rascunho sujo e `fromDisk` diferente de `saved`, grava `external = fromDisk` e **mantém `saved`**. Assim o diff "minha versão × versão salva" continua correto.
- **Aviso na `RequestView`:** um `p-message` com `severity="warn"` e `role="alert"`, com a mensagem "This request changed on disk." e dois botões:
  - **Reload from Disk:** descarta o rascunho e adota `external`.
  - **Keep My Version:** limpa `external` e passa a usá-lo como `saved`, para que o próximo Save grave por cima conscientemente.
- **Ao salvar:** `save()` com `external` pendente pede confirmação ("Overwrite the version on disk?") antes de gravar.
- **Indicador na aba:** o ponto de "alterado" na aba muda para um ícone de aviso enquanto houver conflito. O texto acessível vira "(changed on disk)".

### 2.4 Cenários manuais
- **Trocar de workspace com 2 requests sujas:**
  - Cancel mantém o workspace atual.
  - Save All grava os dois arquivos e troca.
  - Discard troca sem gravar.
- **Remover coleção sem permissão** (pasta somente leitura com "Remove and Delete Files"): o erro aparece e as abas continuam.
- **Excluir uma request suja:** há uma só confirmação e nenhuma aba fantasma fica para trás.
- **Duplo clique no "×" de uma aba suja:** abre um diálogo só.
- **Editar uma request, alterar o mesmo arquivo por fora e voltar:**
  - o aviso de conflito aparece;
  - Reload adota a versão do disco;
  - Keep e depois Save grava a minha versão;
  - Save direto pede confirmação.
- **`Ctrl+S` repetido rápido:** grava uma vez só (conferir pelo `mtime` ou por log).

---

## 3. Fase 2: integridade do disco e da importação

Itens **#3**, **#4**, **#5**, **#16**, **#17** e **#18**, todos no processo main.

- ✅ **#3, duplicar** (feito em 2026-11-02):
  - Request: `createRequest(id, parent, { ...asCopy(request), name })`.
  - Pasta: cada request é lida, passa por `asCopy` (sem `id` nem `operation`) e é regravada com `createOnly`. Os demais arquivos (`_folder.yaml`, anexos) e as requests inválidas continuam copiados como bytes.
  - `OpenApiService.localRequests` registra um aviso no log ao encontrar `operation` repetido.
- **#5, zips do macOS:** em `readZip`, ignorar os segmentos `__MACOSX` e os arquivos `Thumbs.db` e `desktop.ini`, além dos que começam com ".", que já são ignorados.
- **#4, importação atômica** (`importCollection` e `import`):
  1. Validar antes de qualquer gravação: o manifesto e o JSON de ambientes (`restoreEnvironments` passa a ter um `parse` separado do `apply`).
  2. Extrair para `<destino>.importing-<uuid>` na mesma pasta pai, para que o `rename` seja atômico no mesmo disco.
  3. `rename` para o destino final, e só então `open`/`register`, ambientes e `addCollection`.
  4. Em erro: `rm -r` da pasta temporária ou do destino criado e, se a coleção já tiver sido registrada, `delete` do registro no banco. O erro original é relançado.

  A listagem do workspace e o watcher precisam ignorar `*.importing-*`. Como o nome não começa com ".", a regra precisa ser explícita.
- **#18, renomear request:** serializar com o nome novo e gravar no **caminho novo** com `createOnly`. Depois, remover o antigo (pelo `store`, sem lixeira). Se o nome do arquivo não muda, continua a gravação simples no lugar.
- **#17, nomes reservados:** `folderName()` recusa `node_modules`, o arquivo de pasta do formato (`_folder.yaml`), o manifesto (`otto.yaml`) e `openapi-snapshot.json`, sem diferenciar maiúsculas. A mensagem diz que o nome é reservado.
- **#16, listagem truncada:** `list()` passa a devolver `{ entries, truncated }`, ou recebe um `onLimit`. `files()` (exportação) e `duplicate()` lançam erro claro quando o limite é atingido. A árvore continua exibindo o que coube e marca a coleção com um aviso no Overview ("Only the first 10,000 entries are shown").

**Cenários:** duplicar uma request e uma pasta ligadas ao OpenAPI (o painel de sync continua correto, e `otto.request` aponta para o original); importar um .zip feito pelo Finder; importar um .zip com `otto-environments.json` inválido (nada fica no disco nem no banco, e a mesma importação com o arquivo corrigido funciona); criar a pasta `node_modules` (recusada); renomear com o arquivo de destino bloqueado (o original continua intacto).

---

## 4. Fase 3: sincronização e reatividade

Itens **#7**, **#8**, **#9** (o resto), **#10** e **#12**, mais o débito "`workspace.yaml` não é observado" do `PROGRESS.md`.

- **#7, respostas:**
  - `ResponsesState.relocate(collectionId, from, to)`: mesma regra de prefixo do rascunho, preservando uma execução em andamento (`sending`) para que o Cancel continue funcionando.
  - `ResponsesState.forget(collectionId, prefix?)`.
  - Chamar ambos onde a sidebar já chama `drafts.relocate` e nos fluxos da fase 1.
  - Conferir se o `RequestHistoryState` também é indexado por caminho e aplicar o mesmo.
- **#8, watcher resiliente:**
  - `ICollectionWatcher.watch(root, onChange, onError)`. No `error`: limpar o timer, fechar e chamar `onError`.
  - `CollectionService` remove a entrada de `watchers` e agenda uma nova tentativa com backoff (1 s, 5 s, 30 s, depois a cada 60 s) enquanto a coleção estiver aberta.
  - `refresh` recria o watcher se não houver nenhum.
- **#9, recargas em dobro:**
  - **Main:** `emitChanged` registra o instante e, por uma janela curta (por exemplo, 500 ms, maior que o debounce do watcher), o watcher daquela coleção ignora eventos. Os eventos que chegarem depois da janela continuam valendo, o que cobre um `git pull` simultâneo.
  - **Renderer:** a `RequestView` deixa de reler a cada nova árvore. Ela compara uma assinatura do nó da própria request (`method`, nome e, se o main passar a enviar, `mtime`) e só relê quando a assinatura muda ou quando o arquivo é o alvo de um evento externo. A leitura ignora o resultado se `collectionId`/`path` já mudaram (a corrida que sobrou do #6).
- **#10, body em métodos sem corpo:** `interpolateRequest` só interpola o body quando `hasBody(method)`. Caso contrário, devolve o body intacto.
- **#12, spec OpenAPI:** em `OpenApiService.load`, quando `bodyEncoding === 'base64'`, decodificar com `Buffer.from(body, 'base64').toString('utf8')`. Quando `truncated`, lançar "The spec is larger than 50 MB". O limite maior só para o spec fica opcional.
- **`workspace.yaml` observado:** um watcher simples (`fs.watch` não recursivo) no arquivo do workspace ativo, com debounce. Em mudança externa, `WorkspacesState` recarrega a lista de coleções e os ambientes. Gravações do próprio app usam a mesma janela de supressão do #9.

**Cenários:**
- Renomear uma request com resposta: a resposta continua. Renomear durante o envio: o Cancel ainda funciona.
- Remover e recriar a pasta da coleção: as mudanças externas voltam a aparecer sozinhas.
- Salvar uma request: um único reload (contar pelo log do `collections:changed`).
- GET com `{{x}}` no body salvo: envia.
- Spec servido como `application/octet-stream`: importa.
- Editar o `workspace.yaml` por fora (adicionar coleção): a sidebar atualiza.

---

## 5. Fase 4: desempenho e segurança

Item **#19**, mais os débitos de segurança do `PROGRESS.md`.

- **#19, zip assíncrono:** trocar `unzipSync`/`zipSync` por `Unzip` em streaming (com contador do tamanho **real** descompactado, que aborta ao passar de 500 MB) e `zip` assíncrono. A assinatura de `readZip`/`createZip` vira `Promise`.
- **Caminhos no IPC (defesa em profundidade):** os handlers que recebem caminhos (`workspaces:export/import`, `collections:export/import`, `collection-files:*`) só aceitam:
  - caminhos devolvidos por um diálogo do main nesta sessão (um registro `GrantedPaths` com validade curta);
  - caminhos dentro da pasta base ou da coleção, que o `safe-path` já cobre para `collection-files:*`.
- **Arquivos referenciados pela coleção (`bodyFile`, multipart):** antes de ler um arquivo **fora** da pasta da coleção, pedir confirmação uma vez por caminho e por sessão. É o mesmo padrão da confiança nos scripts, e o aviso aparece no console da execução. Coleções em modo `trusted` podem pular a pergunta (decisão D4).

**Cenários:** importar e exportar um .zip grande com a UI respondendo; um .zip com tamanho declarado falso é recusado; um envio via IPC com caminho arbitrário (pelo DevTools) é recusado; uma request com `bodyFile` apontando para `~/.ssh/id_rsa` pede confirmação.

---

## 6. Decisões pendentes

| # | Pergunta | Sugestão |
| - | -------- | -------- |
| D1 | O aviso de rascunhos ao trocar de workspace oferece "Save All" ou só "Discard / Cancel", como ao sair do app? | Oferecer "Save All" e passar a usar o mesmo aviso de três saídas também ao sair, por consistência. |
| D2 | Conflito com o disco (#2): aviso na request ou diálogo modal? | Aviso não modal: o usuário pode comparar antes de decidir. |
| D3 | Janela de supressão do watcher (#9): tempo fixo ou comparação de `mtime`/hash do que o app gravou? | Começar com tempo fixo e trocar por hash se aparecerem falsos negativos. |
| D4 | `bodyFile` fora da coleção: coleções `trusted` também perguntam? | Não perguntar em `trusted`; perguntar em `ask` e `disabled`. |
| D5 | Fazer a fase 4 agora ou deixar para depois do instalador? | Depois: o risco é baixo num app local, e as fases 1 a 3 têm mais impacto para o usuário. |

## 7. Ordem e tamanho estimado

| Fase | Itens | Camadas | Tamanho |
| ---- | ----- | ------- | ------- |
| 1 | #1, #2, #9 (gravação), #13, #14, #21 | renderer | médio-grande (o #2 tem UI nova) |
| 2 | #3, #4, #5, #16, #17, #18 | main | médio |
| 3 | #7, #8, #9, #10, #12, `workspace.yaml` | main e renderer | médio |
| 4 | #19, caminhos no IPC, `bodyFile` | main e renderer | médio |

Ao concluir cada fase: mover os itens para a tabela "Resolvidos" do `ANALISE_PROBLEMAS.md`, atualizar as pendências do `PROGRESS.md` e o status deste plano.
