# Plano de alterações: análise do Otto

> **Status (revisado em 2026-11-02 contra o código):**
> - **Resolvidos (5):** 3 (em 2026-11-02), 6, 11, 15 e 20. Estão resumidos no fim, em [Resolvidos](#resolvidos).
> - **Parciais (2):** 1 (o aviso já aparece ao sair do app) e 9 (o `Ctrl+S` duplicado já foi corrigido).
> - **Pendentes (14):** 1 (parte), 2, 4, 5, 7, 8, 9 (parte), 10, 12, 13, 14, 16, 17, 18, 19 e 21.
>
> A ordem de execução dos pendentes está em [PLANO_CORRECOES.md](PLANO_CORRECOES.md).

Análise feita em 2026-10-20, sem alterações no código. Foram lidos os serviços principais do Electron (coleções, workspaces, HTTP, OpenAPI, zip, watcher) e o estado do Angular (abas, rascunhos, respostas, coleções, OpenAPI, sidebar, request-view). Os problemas estão ordenados do mais grave ao menos grave. A numeração original foi mantida para que referências em commits e conversas continuem valendo.

---

## 🔴 Alta prioridade

### 1. Alterações não salvas se perdem sem aviso ao trocar de workspace ou remover a coleção — 🟡 parcial
##### Já resolvido
Sair do app (File → Quit, `Ctrl+Q`, tray, fechar sem bandeja) passa pelo `before-quit` do main, que pergunta ao renderer (`QuitGuardState`, `src/app/core/state/quit-guard.state.ts`). Com rascunhos sujos, o renderer pede "Discard and Quit".
##### Origem do que falta
- `WorkspacesState.activate()` e `remove()` (`src/app/core/state/workspaces.state.ts:109` e `:194`) chamam só `tabs.flush()` e recarregam, sem olhar `drafts.dirtyKeys()`.
- `src/app/features/collections/remove-collection-dialog.ts:58` chama `tabs.closeCollection(id)`, que remove as abas direto, sem passar pelo aviso.
- `RequestDraftsState` não tem como esquecer rascunhos. Os de coleções e workspaces que saíram de cena ficam em memória.
##### Potencial
O usuário edita várias requests, troca de workspace ou remove a coleção e perde tudo sem aviso. Além disso, os rascunhos ficam órfãos em memória (vazamento).
##### Proposta de solução
- Extrair do `QuitGuardState` um `confirmDiscard(filter?)` reaproveitável em `RequestDraftsState`. Ele lista as requests sujas (todas, ou só as de uma coleção) e pergunta "Salvar tudo / Descartar / Cancelar".
- Chamar esse método em `WorkspacesState.activate/remove` e em `RemoveCollectionDialog.run`.
- Criar `RequestDraftsState.forget(prefix)` e chamá-lo depois de remover a coleção ou trocar de workspace.

### 2. Gravar a request sobrescreve sem aviso alterações externas (git pull, editor)
##### Origem
`RequestDraftsState.loaded()` (`src/app/core/state/request-drafts.state.ts:50`): se o rascunho está sujo, a versão do disco vai para `saved` e a edição local é mantida. Ao salvar, `save()` grava o rascunho por cima, sem checar se o disco mudou.
##### Potencial
Perda silenciosa de mudanças vindas do Git ou de outro editor. É grave num app cuja proposta é "coleções versionadas no disco".
##### Proposta de solução
Guardar no `DraftEntry` um sinal de conflito (`external: RequestDefinition | null`) quando chega uma versão diferente do disco com o rascunho sujo. Mostrar um aviso na request-view ("O arquivo mudou no disco: Recarregar / Manter minha versão") e, no `save()`, pedir confirmação se houver conflito.

### 4. Importação de coleção ou workspace deixa pasta pela metade quando falha
##### Origem
`WorkspaceService.importCollection()` e `import()` (`electron/main/services/workspaces/workspace.service.ts:239` e `:408`) criam a pasta e gravam arquivo por arquivo. Se algo falha no meio (arquivo existente, JSON de ambientes inválido em `restoreEnvironments`, manifesto inválido no `open`), nada é desfeito. Em `importCollection`, a coleção ainda pode ficar registrada no banco sem estar no workspace.
##### Potencial
- A pasta parcial bloqueia novas tentativas ("already has a collection folder named…").
- Fica uma coleção órfã no SQLite.
- O usuário precisa apagar a pasta à mão.
##### Proposta de solução
Validar tudo antes de gravar (manifesto, JSON de ambientes) e extrair numa pasta temporária ao lado (`<slug>.importing-xxxx`). Só renomear para o destino final no fim. Em caso de erro, apagar a pasta temporária e o registro no banco (`try/catch` com rollback).

### 5. Zips criados no macOS não importam (`__MACOSX/`)
##### Origem
`archiveRoot()` (`electron/main/services/workspaces/workspace.service.ts:41`) exige uma única pasta no topo do zip. `readZip` (`electron/main/infra/workspaces/zip-archive.ts:61`) ignora só itens que começam com ".", mas o Finder cria a pasta `__MACOSX/` no topo.
##### Potencial
Ao compactar uma coleção pelo Finder e importar, aparece "No otto.yaml found: this is not an Otto backup". Atinge todo usuário de Mac.
##### Proposta de solução
Em `readZip`, ignorar também as entradas `__MACOSX/` (e `Thumbs.db`, `desktop.ini`). Outra opção: `archiveRoot` desconsiderar essas pastas ao calcular os itens do topo.

---

## 🟠 Média prioridade

### 7. A resposta some ao renomear ou mover e fica presa após excluir
##### Origem
`ResponsesState` usa a chave `collectionId:path` (`src/app/core/state/responses.state.ts:19`). Rename e drag & drop (`collections-sidebar.ts` → `relocate`, linha 430) atualizam abas, rascunhos e pastas expandidas, mas não as respostas.
##### Potencial
Depois de renomear ou mover uma request, a última resposta desaparece. Se uma request estava sendo enviada, o resultado é descartado e o Cancel deixa de funcionar. O encadeamento (`otto.request(…)`) também perde a resposta em cache.
##### Proposta de solução
Criar `ResponsesState.relocate(collectionId, from, to)` (mesma lógica de prefixo do rascunho) e chamá-lo junto com `drafts.relocate`. Criar também `ResponsesState.forget(prefix)` para usar ao excluir ou fechar a coleção.

### 8. O watcher para de vez após um erro e nunca volta
##### Origem
`FsCollectionWatcher` (`electron/main/infra/collections/fs-collection-watcher.ts:29`, `watcher.on('error', () => watcher.close())`) fecha o watcher. `CollectionService.startWatching` (`collection.service.ts:593`) continua com a entrada no `Map`, então nunca recria o watcher. O `timer` de debounce também não é limpo nesse caminho.
##### Potencial
Depois que a pasta é desmontada/remontada, renomeada e restaurada, ou depois de um `EMFILE`, as mudanças externas (git pull) deixam de aparecer até reiniciar o app.
##### Proposta de solução
- No erro: limpar o timer e notificar o serviço (callback `onError`).
- O serviço remove a entrada de `watchers` e tenta observar de novo com backoff.
- Ao chamar `refresh` da coleção, recriar o watcher se não houver nenhum.

### 9. Toda gravação feita pelo app gera recargas em dobro (árvore e request) — 🟡 parcial
##### Já resolvido
O `Ctrl+S` disparava duas vezes, pelo atalho do renderer e pelo acelerador do menu nativo. Os aceleradores do menu agora usam `registerAccelerator: false` (`electron/main/ui/menu.ts:19`), e só o renderer trata a tecla.
##### Origem do que falta
- Cada operação do `CollectionService` chama `emitChanged` (`collection.service.ts:602`), e o watcher dispara outro `changed` logo depois (debounce).
- `CollectionsState.refresh` relê árvore e manifesto.
- A `RequestView` relê o arquivo a cada mudança de `collections.find(id)?.tree` (`src/app/features/request/request-view.ts:393`). A árvore é um objeto novo a cada refresh, então qualquer mudança na coleção relê a request.
- `RequestDraftsState.save` não protege contra gravações concorrentes da mesma chave (`Ctrl+S` repetido, "Save All" durante um "Save"). As duas gravam, porque `saved` só é atualizado depois do IPC.
##### Potencial
- E/S e IPC desnecessários (coleções grandes ficam lentas).
- A request "pisca".
- Gravações duplicadas acionam o watcher outra vez.
##### Proposta de solução
- Ignorar no watcher os eventos gerados pelo próprio app (janela de supressão após `emitChanged`, ou comparar mtime).
- Na `RequestView`, só reler quando o nó da própria request mudou (por exemplo, um hash ou o `mtime` do nó).
- Em `RequestDraftsState.save`, guardar uma promise em andamento por chave para evitar gravação concorrente.

### 10. Variáveis do body bloqueiam o envio de GET/HEAD mesmo sem body
##### Origem
`interpolateRequest` (`electron/shared/http/interpolate.ts:58`) interpola o body sempre. `buildHttpRequest` (`build-request.ts:113`) descarta o body para métodos sem corpo, mas a variável não resolvida já barrou o envio na interpolação.
##### Potencial
Uma request trocada de POST para GET que ainda tem `{{id}}` no JSON salvo retorna "{{id}} is not defined" e não envia, embora o body nem seria enviado.
##### Proposta de solução
Em `interpolateRequest`, só interpolar o body quando `hasBody(definition.method)`. Caso contrário, devolver o body sem tocar.

### 12. Download do spec OpenAPI pode chegar truncado ou em base64
##### Origem
`OpenApiService.load()` (`electron/main/services/openapi/openapi.service.ts:296`) usa o executor HTTP e devolve `response.body` sem checar `truncated` nem `bodyEncoding`. Specs com `Content-Type` não textual (`application/octet-stream`, `application/vnd.oai.openapi` em YAML) chegam em base64.
##### Potencial
Erros de parse confusos ("Invalid spec") em specs válidos, ou spec grande cortado no limite `MAX_RESPONSE_BYTES`.
##### Proposta de solução
- Se `bodyEncoding === 'base64'`, decodificar para UTF-8.
- Se `truncated`, retornar um erro claro ("Spec maior que X MB").
- Opcional: aumentar o limite só para o download do spec.

### 13. A remoção de coleção fecha as abas antes de confirmar o sucesso
##### Origem
`src/app/features/collections/remove-collection-dialog.ts:58` chama `tabs.closeCollection(id)` antes de `collections.trash/close`.
##### Potencial
Se a remoção falha (sem permissão, lixeira indisponível), a coleção continua, mas as abas e os rascunhos já foram perdidos.
##### Proposta de solução
Fechar as abas só depois da operação bem-sucedida, junto com o aviso de alterações não salvas do item 1.

### 14. Excluir uma request com rascunho sujo pode deixar uma aba "fantasma"
##### Origem
`CollectionsSidebar.delete()` (`src/app/features/collections/collections-sidebar.ts:609`) apaga o arquivo e depois chama `tabs.close()`, que passa pelo aviso de alterações. Se o usuário escolhe manter, a aba fica apontando para um arquivo que não existe mais.
##### Potencial
A aba mostra "Could not read this request", e salvar recria o arquivo excluído em outro estado.
##### Proposta de solução
Perguntar sobre as alterações antes de excluir (uma única confirmação: "Mover para a lixeira e descartar alterações?"). Depois de excluir, remover as abas e os rascunhos direto, sem passar pelo aviso de novo.

---

## 🟡 Baixa prioridade

### 16. Listagem truncada em silêncio (limite de 10.000 entradas ou 32 níveis)
##### Origem
`FsCollectionStore.list()` (`electron/main/infra/collections/fs-collection-store.ts:53`) para no `MAX_ENTRIES`/`MAX_DEPTH` sem avisar. `files()` (exportação) e `duplicate()` (pasta) usam essa listagem.
##### Potencial
A exportação ou a duplicação de pasta fica incompleta, e o usuário não fica sabendo.
##### Proposta de solução
Retornar um sinal `truncated` (ou lançar erro em `files()`/`duplicate()`) e avisar na interface.

### 17. Pastas com nomes reservados somem da árvore
##### Origem
`IGNORED_DIRECTORIES = ['node_modules']` em `list()` (`fs-collection-store.ts:8`), mas `folderName()` (`collection.service.ts:19`) aceita esse nome ao criar ou renomear. Nomes como `_folder.yaml` também passam pela validação.
##### Potencial
O usuário cria ou renomeia uma pasta e ela "desaparece".
##### Proposta de solução
Rejeitar em `folderName()` os nomes reservados (`node_modules`, o arquivo de pasta do formato, o manifesto e `openapi-snapshot.json`).

### 18. Renomear uma request não é atômico
##### Origem
`CollectionService.rename()` (`electron/main/services/collections/collection.service.ts:385`) grava o novo `name` no arquivo antigo e só depois move.
##### Potencial
Se o move falha, o arquivo fica com o nome novo no caminho antigo, e o renderer recebe um erro mesmo com a mudança parcial já gravada.
##### Proposta de solução
Gravar direto no caminho novo (`writeFile` com `createOnly`) e depois remover o antigo, ou desfazer o `name` se o move falhar.

### 19. Leitura e escrita de zip síncronas no processo main
##### Origem
`readZip`/`createZip` usam `unzipSync`/`zipSync` (`electron/main/infra/workspaces/zip-archive.ts`). O limite anti-zip-bomb confia em `originalSize`, que vem do cabeçalho do zip.
##### Potencial
A interface trava ao importar ou exportar coleções grandes. Um zip malicioso pode declarar tamanhos falsos.
##### Proposta de solução
Usar as versões assíncronas do fflate (`unzip`/`zip`, que rodam em worker). Validar o tamanho real descompactado durante o streaming (`Unzip` com contador).

### 21. Duplo clique em fechar abre duas confirmações
##### Origem
`TabsState.close()` (`src/app/core/state/tabs.state.ts:137`) não marca a aba como "fechando" enquanto o aviso assíncrono está aberto. O mesmo vale para o fechamento em lote (`:189` e `:198`).
##### Potencial
Dois diálogos de "Unsaved Changes" empilhados para a mesma aba.
##### Proposta de solução
Manter um `Set` de IDs com fechamento pendente e ignorar novas chamadas até o aviso responder.

---

## Resolvidos

| # | Problema | Como foi resolvido |
| - | -------- | ------------------ |
| 3 | "Duplicate" copiava o vínculo OpenAPI (`operation`) e, na pasta, também os `id` | `CollectionService.duplicate()` grava a cópia com `asCopy()`: sem `operation` e sem `id`, e o `serializeRequest` gera um `id` novo. Na duplicação de pasta, cada request é regravada assim. Os demais arquivos e as requests inválidas continuam copiados byte a byte. `OpenApiService.localRequests()` registra um aviso no log quando encontra `operation` repetido em cópias antigas. |
| 6 | Request-view reaproveitada entre abas mostrava erro ou estado de outra request | O `TabHost` cria uma view por aba visitada e a mantém viva (só o DOM da ativa fica no documento). `error`, `saveError` e `saving` não vazam mais entre abas. Ainda existe uma corrida menor quando a própria aba muda de caminho (renomear/mover durante uma leitura), que entra no item 9. |
| 11 | Auth "Inherit from Collection" não enviava nada | `auth: inherit` é resolvido no envio (`TemplateContextService.prepare`): vale a pasta mais próxima com auth, senão a coleção. A aba Auth mostra de onde vem. |
| 15 | Segredos de ambiente gravados e exportados em texto puro | `EncryptedEnvironmentRepository` cifra com `safeStorage`. Backups, exportações e o `workspace.yaml` levam as variáveis secretas sem valor. |
| 20 | Código de debug e imports não usados na request-view | `teste(event: any)`, o `<p-editor>` comentado, `EditorModule`/`FormsModule` e a dependência `quill` foram removidos. |
