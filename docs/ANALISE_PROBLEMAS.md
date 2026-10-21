# Plano de alterações: análise do Otto

Análise feita em 2026-10-20, sem alterações no código. Foram lidos os serviços principais do Electron (coleções, workspaces, HTTP, OpenAPI, zip, watcher) e o estado do Angular (abas, rascunhos, respostas, coleções, OpenAPI, sidebar, request-view). Os problemas estão ordenados do mais grave ao menos grave.

---

## 🔴 Alta prioridade

### 1. Alterações não salvas se perdem sem aviso ao trocar de workspace, fechar o app ou remover a coleção
##### Origem
- O único aviso existe ao fechar uma aba (`TabsState.setCloseGuard` em `src/app/core/state/request-drafts.state.ts:34`).
- `WorkspacesState.activate()` (`src/app/core/state/workspaces.state.ts`) chama só `tabs.flush()` e recarrega, sem olhar `drafts.dirtyKeys()`.
- `electron/main/ui/window.ts:94` (`win.on('close')`) fecha a janela sem consultar o renderer.
- `src/app/features/collections/remove-collection-dialog.ts:81` chama `tabs.closeCollection(id)`, que remove as abas direto, sem passar pelo aviso.
##### Potencial
O usuário edita várias requests, troca de workspace ou fecha o app e perde tudo sem aviso. Além disso, os rascunhos ficam órfãos em memória (vazamento).
##### Proposta de solução
- Criar em `RequestDraftsState` um método `confirmDiscardAll(filter?)`, que lista as requests sujas e pergunta "Salvar tudo / Descartar / Cancelar".
- Chamar esse método em `WorkspacesState.activate/remove` e em `RemoveCollectionDialog.submit`, e limpar os rascunhos da coleção/workspace removidos.
- No main: interceptar o `close` (quando não for para a bandeja) e o `before-quit`, perguntar ao renderer via IPC (`app:can-close`) e só sair após a confirmação.

### 2. Gravar a request sobrescreve sem aviso alterações externas (git pull, editor)
##### Origem
`RequestDraftsState.loaded()` (`src/app/core/state/request-drafts.state.ts:49`): se o rascunho está sujo, a versão do disco vai para `saved` e a edição local é mantida. Ao salvar, `save()` grava o rascunho por cima, sem checar se o disco mudou.
##### Potencial
Perda silenciosa de mudanças vindas do Git ou de outro editor. É grave num app cuja proposta é "coleções versionadas no disco".
##### Proposta de solução
Guardar no `DraftEntry` um sinal de conflito (`external: RequestDefinition | null`) quando chega uma versão diferente do disco com o rascunho sujo. Mostrar um aviso na request-view ("O arquivo mudou no disco: Recarregar / Manter minha versão") e, no `save()`, pedir confirmação se houver conflito.

### 3. "Duplicate" copia o vínculo OpenAPI (`operation`) e confunde a sincronização
##### Origem
`CollectionService.duplicate()` (`electron/main/services/collections/collection.service.ts:270-273`) copia a request inteira, inclusive `operation`. `OpenApiService.localRequests()` (`electron/main/services/openapi/openapi.service.ts:316`) fica só com a primeira request de cada `operation`, conforme a ordem de leitura do disco.
##### Potencial
- Depois de duplicar uma request ligada a um spec, o sync/revert pode sobrescrever a cópia em vez do original, ou ignorar a original.
- O painel mostra diferenças erradas ("modified"/"in sync" trocados).
##### Proposta de solução
Na duplicação de request, remover o vínculo (`{ ...request, name, operation: undefined/null }`). Na duplicação de pasta, fazer o mesmo para cada `.yaml` de request copiado. Opcional: em `localRequests`, avisar quando houver `operation` duplicado.

### 4. Importação de coleção ou workspace deixa pasta pela metade quando falha
##### Origem
`WorkspaceService.importCollection()` e `import()` (`electron/main/services/workspaces/workspace.service.ts:165-200` e `334-374`) criam a pasta e gravam arquivo por arquivo. Se algo falha no meio (arquivo existente, JSON de ambientes inválido em `restoreEnvironments`, manifesto inválido no `open`), nada é desfeito. Em `importCollection`, a coleção ainda pode ficar registrada no banco sem estar no workspace.
##### Potencial
- A pasta parcial bloqueia novas tentativas ("already has a collection folder named…").
- Fica uma coleção órfã no SQLite.
- O usuário precisa apagar a pasta à mão.
##### Proposta de solução
Validar tudo antes de gravar (manifesto, JSON de ambientes) e extrair numa pasta temporária ao lado (`<slug>.importing-xxxx`). Só renomear para o destino final no fim. Em caso de erro, apagar a pasta temporária e o registro no banco (`try/catch` com rollback).

### 5. Zips criados no macOS não importam (`__MACOSX/`)
##### Origem
`archiveRoot()` (`electron/main/services/workspaces/workspace.service.ts:31-40`) exige uma única pasta no topo do zip. `readZip` ignora só itens que começam com ".", mas o Finder cria a pasta `__MACOSX/` no topo.
##### Potencial
Ao compactar uma coleção pelo Finder e importar, aparece "No otto.yaml found: this is not an Otto backup". Atinge todo usuário de Mac.
##### Proposta de solução
Em `readZip`, ignorar também as entradas `__MACOSX/` (e `Thumbs.db`, `desktop.ini`). Outra opção: `archiveRoot` desconsiderar essas pastas ao calcular os itens do topo.

---

## 🟠 Média prioridade

### 6. A request-view reaproveitada entre abas mostra erro ou estado de outra request
##### Origem
`TabHost` renderiza só a aba ativa e o mesmo `@case ('request')` reutiliza a instância de `RequestView` trocando os inputs. Os sinais `error`, `saveError` e `saving` (`src/app/features/request/request-view.ts:222-224`) não são zerados ao trocar de request. Além disso, `load()` é assíncrono sem controle de corrida: a leitura da aba anterior pode terminar depois e gravar `error` na aba atual.
##### Potencial
- "Could not save" ou "Could not read this request" aparece na request errada.
- O botão Save pode ficar em loading na outra aba.
##### Proposta de solução
- Zerar `error/saveError/saving` quando `key()` mudar (`linkedSignal` com origem em `key`, ou `effect`).
- Em `load()`, ignorar o resultado se `draftKey(collectionId, path)` já não for o atual.
- Alternativa: `@for (tab of [tab]; track tab.id)` para recriar o componente a cada aba.

### 7. A resposta some ao renomear ou mover e fica presa após excluir
##### Origem
`ResponsesState` usa a chave `collectionId:path` (`src/app/core/state/responses.state.ts:15`). Rename e drag & drop (`collections-sidebar.ts` → `relocate`) atualizam abas e rascunhos, mas não as respostas.
##### Potencial
Depois de renomear ou mover uma request, a última resposta desaparece. Se uma request estava sendo enviada, o resultado é descartado e o Cancel deixa de funcionar.
##### Proposta de solução
Criar `ResponsesState.relocate(collectionId, from, to)` (mesma lógica de prefixo do rascunho) e chamá-lo junto com `drafts.relocate`. Criar também `ResponsesState.forget(prefix)` para usar ao excluir ou fechar a coleção.

### 8. O watcher para de vez após um erro e nunca volta
##### Origem
`FsCollectionWatcher` (`watcher.on('error', () => watcher.close())`) fecha o watcher. `CollectionService.startWatching` continua com a entrada no `Map`, então nunca recria o watcher. O `timer` de debounce também não é limpo nesse caminho.
##### Potencial
Depois que a pasta é desmontada/remontada, renomeada e restaurada, ou depois de um `EMFILE`, as mudanças externas (git pull) deixam de aparecer até reiniciar o app.
##### Proposta de solução
- No erro: limpar o timer e notificar o serviço (callback `onError`).
- O serviço remove a entrada de `watchers` e tenta observar de novo com backoff.
- Ao chamar `refresh` da coleção, recriar o watcher se não houver nenhum.

### 9. Toda gravação feita pelo app gera recargas em dobro (árvore e request)
##### Origem
- Cada operação do `CollectionService` chama `emitChanged`, e o watcher dispara outro `changed` logo depois (debounce).
- `CollectionsState.refresh` relê árvore e manifesto.
- A `RequestView` relê o arquivo a cada mudança de `collections.find(id)` (`src/app/features/request/request-view.ts:262-268`), inclusive mudanças só no manifesto.
- Ctrl+S dispara duas vezes (atalho do renderer em `src/app/shell/shell.ts:204` e acelerador do menu nativo), e as duas chamadas gravam porque `saved` só é atualizado depois do IPC.
##### Potencial
- E/S e IPC desnecessários (coleções grandes ficam lentas).
- A request "pisca".
- Gravações duplicadas acionam o watcher outra vez.
##### Proposta de solução
- Ignorar no watcher os eventos gerados pelo próprio app (janela de supressão após `emitChanged`, ou comparar mtime).
- Na `RequestView`, só reler quando a árvore mudou (comparar `tree` por referência ou por um hash do nó).
- Em `RequestDraftsState.save`, guardar uma promise em andamento por chave para evitar gravação concorrente.

### 10. Variáveis do body bloqueiam o envio de GET/HEAD mesmo sem body
##### Origem
`interpolateRequest` (`electron/shared/http/interpolate.ts:72-89`) interpola o body sempre. `buildHttpRequest` descarta o body para métodos sem corpo, mas a checagem de `unresolved` em `ResponsesState.send` já barrou o envio.
##### Potencial
Uma request trocada de POST para GET que ainda tem `{{id}}` no JSON salvo retorna "{{id}} is not defined" e não envia, embora o body nem seria enviado.
##### Proposta de solução
Em `interpolateRequest`, só interpolar o body quando `hasBody(definition.method)`; caso contrário, devolver o body sem tocar.

### 11. Auth "Inherit from Collection" não envia nada, em silêncio
##### Origem
`electron/shared/http/build-request.ts:107`: `inherit` ainda não foi implementado ("Etapa 8"), mas o valor é aceito no modelo, aparece no editor (`src/app/features/request/auth-editor.ts:101`) e pode vir de importações.
##### Potencial
A request vai sem autenticação, e o usuário vê 401/403 sem entender o motivo.
##### Proposta de solução
Enquanto a auth de coleção não existir: mostrar um aviso no editor ("Collection auth is not available yet; nothing will be sent") e uma linha na timeline do envio. Depois, implementar `auth` no `otto.yaml` e resolvê-la em `ResponsesState.send`.

### 12. Download do spec OpenAPI pode chegar truncado ou em base64
##### Origem
`OpenApiService.load()` (`electron/main/services/openapi/openapi.service.ts:299-309`) usa o executor HTTP e devolve `response.body` sem checar `truncated` nem `bodyEncoding`. Specs com `Content-Type` não textual (`application/octet-stream`, `application/vnd.oai.openapi` em YAML) chegam em base64.
##### Potencial
Erros de parse confusos ("Invalid spec") em specs válidos, ou spec grande cortado no limite `MAX_RESPONSE_BYTES`.
##### Proposta de solução
- Se `bodyEncoding === 'base64'`, decodificar para UTF-8.
- Se `truncated`, retornar um erro claro ("Spec maior que X MB").
- Opcional: aumentar o limite só para o download do spec.

### 13. A remoção de coleção fecha as abas antes de confirmar o sucesso
##### Origem
`src/app/features/collections/remove-collection-dialog.ts:81` chama `tabs.closeCollection(id)` antes de `collections.trash/close`.
##### Potencial
Se a remoção falha (sem permissão, lixeira indisponível), a coleção continua, mas as abas e os rascunhos já foram perdidos.
##### Proposta de solução
Fechar as abas só depois da operação bem-sucedida, junto com o aviso de alterações não salvas do item 1.

### 14. Excluir uma request com rascunho sujo pode deixar uma aba "fantasma"
##### Origem
`src/app/features/collections/collections-sidebar.ts` (método `delete`) apaga o arquivo e depois chama `tabs.close()`, que passa pelo aviso de alterações. Se o usuário escolhe manter, a aba fica apontando para um arquivo que não existe mais.
##### Potencial
A aba mostra "Could not read this request", e salvar recria o arquivo excluído em outro estado.
##### Proposta de solução
Perguntar sobre as alterações antes de excluir (uma única confirmação: "Mover para a lixeira e descartar alterações?"). Depois de excluir, remover as abas e os rascunhos direto, sem passar pelo aviso de novo.

---

## 🟡 Baixa prioridade

### 15. Segredos de ambiente gravados e exportados em texto puro
##### Origem
As variáveis com `secret: true` vão sem criptografia para o SQLite e para o `otto-environments.json` dos backups (`electron/main/services/collections/environment-backup.ts`).
##### Potencial
Tokens e senhas vazam ao compartilhar um backup .zip ou o banco.
##### Proposta de solução
- Cifrar os valores secretos com `safeStorage` do Electron no repositório.
- Na exportação, omitir os segredos por padrão (com uma opção "incluir segredos" e um aviso).

### 16. Listagem truncada em silêncio (limite de 10.000 entradas ou 32 níveis)
##### Origem
`FsCollectionStore.list()` (`electron/main/infra/collections/fs-collection-store.ts:53-85`) para no `MAX_ENTRIES`/`MAX_DEPTH` sem avisar. `files()` (exportação) e `duplicate()` (pasta) usam essa listagem.
##### Potencial
A exportação ou a duplicação de pasta fica incompleta, e o usuário não fica sabendo.
##### Proposta de solução
Retornar um sinal `truncated` (ou lançar erro em `files()`/`duplicate()`) e avisar na interface.

### 17. Pastas com nomes reservados somem da árvore
##### Origem
`IGNORED_DIRECTORIES = ['node_modules']` em `list()`, mas `folderName()`/`parseEntryName` aceitam esse nome ao criar ou renomear. Nomes como `_folder.yaml` também passam pela validação.
##### Potencial
O usuário cria ou renomeia uma pasta e ela "desaparece".
##### Proposta de solução
Rejeitar em `folderName()` os nomes reservados (`node_modules`, `formato.folderFile`, `manifestFile`, `openapi-snapshot.json`).

### 18. Renomear uma request não é atômico
##### Origem
`CollectionService.rename()` (`electron/main/services/collections/collection.service.ts:322-326`) grava o novo `name` no arquivo antigo e só depois move.
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

### 20. Código de debug e imports não usados na request-view
##### Origem
`src/app/features/request/request-view.ts:319-321` (`teste(event: any)` com `console.log`), `EditorModule` (Quill) e `FormsModule` importados sem uso, e um bloco `<p-editor>` comentado.
##### Potencial
O bundle fica maior (Quill), há `any` contra as regras do projeto e a manutenção fica mais confusa.
##### Proposta de solução
Remover `teste`, o comentário do `<p-editor>`, `EditorModule` e `FormsModule` (se não forem usados por outro trecho do template).

### 21. Duplo clique em fechar abre duas confirmações
##### Origem
`TabsState.close()` (`src/app/core/state/tabs.state.ts:131-145`) não marca a aba como "fechando" enquanto o aviso assíncrono está aberto.
##### Potencial
Dois diálogos de "Unsaved Changes" empilhados para a mesma aba.
##### Proposta de solução
Manter um `Set` de IDs com fechamento pendente e ignorar novas chamadas até o aviso responder.

---

## Ordem sugerida de execução
1. Itens **1, 2, 6 e 13/14**: proteção contra perda de dados no frontend.
2. Itens **3, 4 e 5**: integridade de OpenAPI e importação.
3. Itens **7 a 12**: funcionalidade e desempenho.
4. Itens **15 a 21**: segurança e limpeza.
