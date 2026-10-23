/**
 * API exposta em `window.otto` pelo preload, segregada por responsabilidade (ISP):
 * cada consumidor no Angular depende apenas da fatia que usa.
 */
import type {
    CollectionExportFormat,
    CollectionImportRequest,
    AppInfo,
    CollectionMetadata,
    CollectionTree,
    OpenedCollection,
    RequestDefinition,
    EntityId,
    Environment,
    HistoryEntry,
    HistoryQuery,
    HttpRequest,
    HttpResult,
    CommandId,
    KeybindingOverrides,
    MenuAction,
    NewCollectionMetadata,
    NewEnvironment,
    OttoSettings,
    SettingsPatch,
    TabState,
    ThemeState,
    WindowState,
    LoadedWorkspace,
    Workspace,
    WorkspaceSummary,
    CollectionManifest,
    CollectionManifestPatch,
    OpenApiConfig,
    OpenApiStatus,
    UpdateState
} from './models';

export interface AppApi {
    info(): Promise<AppInfo>;
    /** Reinicia o app (preferências aplicadas só na inicialização). */
    relaunch(): Promise<void>;
    /** Libera a saída do app depois de `onQuitRequested`. */
    confirmQuit(): Promise<void>;
    /** O usuário pediu para encerrar o app; só sai após `confirmQuit()`. */
    onQuitRequested(listener: () => void): () => void;
}

/** Controles da janela para a barra de título própria. */
export interface WindowApi {
    state(): Promise<WindowState>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    /** Equivale ao botão fechar nativo (respeita "manter na bandeja"). */
    close(): Promise<void>;
    /** Abre o menu da aplicação na posição indicada (coordenadas da janela). */
    showAppMenu(x: number, y: number): Promise<void>;
    onStateChanged(listener: (state: WindowState) => void): () => void;
}

export interface SettingsApi {
    get(): Promise<OttoSettings>;
    /** Aplica um patch parcial (validado no main) e retorna as settings completas. */
    set(patch: SettingsPatch): Promise<OttoSettings>;
    /** Notifica mudanças feitas em qualquer lugar (renderer, tray). Retorna a função para remover o listener. */
    onChanged(listener: (settings: OttoSettings) => void): () => void;
}

export interface ThemeApi {
    get(): Promise<ThemeState>;
    /** Disparado quando a preferência ou o tema do sistema operacional muda. */
    onChanged(listener: (state: ThemeState) => void): () => void;
}

/** Atalhos personalizados (só as diferenças em relação ao padrão). */
export interface KeybindingsApi {
    get(): Promise<KeybindingOverrides>;
    /** Substitui todos os overrides (validados no main) e retorna o resultado gravado. */
    set(overrides: KeybindingOverrides): Promise<KeybindingOverrides>;
    /** Restaura o padrão de um comando ou, sem `id`, de todos. */
    reset(id?: CommandId): Promise<KeybindingOverrides>;
    onChanged(listener: (overrides: KeybindingOverrides) => void): () => void;
}

export interface HttpApi {
    send(request: HttpRequest): Promise<HttpResult>;
    cancel(id: string): Promise<boolean>;
}

export interface DialogApi {
    /** Seletor de arquivo de certificado (PEM/CRT). */
    pickCertificate(): Promise<string | null>;
    /** Arquivo qualquer (corpo File/Binary ou campo de arquivo do multipart). */
    pickFile(title: string): Promise<string | null>;
    /** Spec OpenAPI/Swagger local (.json/.yaml) para importar como coleção. */
    pickOpenApiFile(): Promise<string | null>;
    /** Arquivo .zip de um backup de coleção do Otto. */
    pickCollectionArchive(): Promise<string | null>;
    saveCollectionArchive(defaultName: string): Promise<string | null>;
    /** Destino do spec OpenAPI exportado (.yaml ou .json). */
    saveOpenApiSpec(defaultName: string): Promise<string | null>;
    /** Arquivo .zip de um workspace exportado pelo Otto. */
    pickWorkspaceArchive(): Promise<string | null>;
    saveWorkspaceArchive(defaultName: string): Promise<string | null>;
    /** Pasta base dos workspaces (Preferences). */
    chooseBaseDirectory(current?: string): Promise<string | null>;
}

export interface HistoryApi {
    list(query?: HistoryQuery): Promise<HistoryEntry[]>;
    delete(id: EntityId): Promise<boolean>;
    /** Retorna quantos registros foram removidos. */
    clear(): Promise<number>;
    /** Avisa quando uma execução é registrada (para atualizar listas abertas). */
    onChanged(listener: () => void): () => void;
}

export interface TabsApi {
    list(workspaceId: EntityId): Promise<TabState[]>;
    /** Substitui o conjunto de abas persistidas do workspace. */
    save(workspaceId: EntityId, tabs: TabState[]): Promise<void>;
}

export interface WorkspacesApi {
    list(): Promise<WorkspaceSummary[]>;
    /** Abre as coleções do workspace ativo (relendo o `workspace.yaml`). */
    load(): Promise<LoadedWorkspace>;
    switch(id: EntityId): Promise<Workspace>;
    /** Cria `<pasta base>/<nome>` com `workspace.yaml` e ativa. */
    create(name: string): Promise<Workspace>;
    rename(id: EntityId, name: string): Promise<Workspace>;
    /** Tira da lista; a pasta no disco não é apagada. */
    remove(id: EntityId): Promise<void>;
    /** Recria a pasta e o `workspace.yaml` de um workspace cuja pasta sumiu (mantém as coleções que ainda existem). */
    recreate(id: EntityId): Promise<Workspace>;
    export(id: EntityId, file: string): Promise<void>;
    /** Extrai o .zip em `<pasta base>/<nome>` e ativa. */
    import(file: string): Promise<Workspace>;
    /** Mostra a pasta do workspace no gerenciador de arquivos. */
    reveal(id: EntityId): Promise<void>;
    onChanged(listener: () => void): () => void;
}

export interface EnvironmentsApi {
    /** `null` lista os ambientes globais. */
    list(collectionId: EntityId | null): Promise<Environment[]>;
    get(id: EntityId): Promise<Environment | null>;
    create(input: NewEnvironment): Promise<Environment>;
    update(id: EntityId, patch: Partial<NewEnvironment>): Promise<Environment | null>;
    delete(id: EntityId): Promise<boolean>;
}

export interface CollectionsApi {
    list(): Promise<CollectionMetadata[]>;
    get(id: EntityId): Promise<CollectionMetadata | null>;
    create(input: NewCollectionMetadata): Promise<CollectionMetadata>;
    update(id: EntityId, patch: Partial<NewCollectionMetadata>): Promise<CollectionMetadata | null>;
    /** Esquece a coleção (não apaga nada do disco). */
    delete(id: EntityId): Promise<boolean>;
    /** Cria `<workspace>/collections/<nome>` com o manifesto e inclui no workspace ativo. */
    createOnDisk(name: string): Promise<OpenedCollection>;
    /** Importa para o workspace ativo um backup do Otto (.zip) ou um spec OpenAPI (URL/arquivo). */
    import(request: CollectionImportRequest): Promise<OpenedCollection>;
    /** `backup`: .zip com arquivos e ambientes da coleção; `openapi`: spec OpenAPI 3 (.yaml/.json). */
    export(id: EntityId, format: CollectionExportFormat, file: string): Promise<void>;
    close(id: EntityId): Promise<void>;
    /** Tira do workspace ativo e envia a pasta da coleção para a lixeira do sistema. */
    trash(id: EntityId): Promise<void>;
    tree(id: EntityId): Promise<CollectionTree>;
    /** `otto.yaml` atual (descrição, headers da coleção, ligação OpenAPI). */
    manifest(id: EntityId): Promise<CollectionManifest>;
    updateManifest(id: EntityId, patch: CollectionManifestPatch): Promise<CollectionManifest>;
    /** Disparado quando arquivos da coleção mudam (pelo app, git, editor...). */
    onChanged(listener: (event: { collectionId: EntityId }) => void): () => void;
}

/** Ligação de uma coleção com um spec OpenAPI/Swagger. */
export interface OpenApiApi {
    /** `refresh` busca o spec de novo (senão usa o da última verificação). */
    status(collectionId: EntityId, refresh?: boolean): Promise<OpenApiStatus>;
    connect(collectionId: EntityId, config: OpenApiConfig): Promise<OpenApiStatus>;
    disconnect(collectionId: EntityId): Promise<void>;
    spec(collectionId: EntityId): Promise<string>;
    /** Aplica as atualizações do spec escolhidas (por `MÉTODO /caminho`). */
    sync(collectionId: EntityId, keys: string[]): Promise<OpenApiStatus>;
    /** Volta as requisições escolhidas ao último spec sincronizado. */
    revert(collectionId: EntityId, keys: string[]): Promise<OpenApiStatus>;
}

/** Arquivos dentro de uma coleção. Caminhos são relativos à raiz e usam `/`. */
export interface CollectionFilesApi {
    readRequest(collectionId: EntityId, path: string): Promise<RequestDefinition>;
    saveRequest(collectionId: EntityId, path: string, request: RequestDefinition): Promise<void>;
    /** Cria um arquivo com nome derivado de `request.name`; retorna o caminho criado. */
    createRequest(collectionId: EntityId, folder: string, request: RequestDefinition): Promise<string>;
    createFolder(collectionId: EntityId, parent: string, name: string): Promise<string>;
    move(collectionId: EntityId, from: string, to: string): Promise<void>;
    /** Copia a requisição ou a pasta (com tudo dentro) na mesma pasta, com o novo nome; retorna o caminho criado. */
    duplicate(collectionId: EntityId, path: string, name: string): Promise<string>;
    /** Renomeia a requisição (nome e arquivo) ou a pasta; retorna o novo caminho. */
    rename(collectionId: EntityId, path: string, name: string): Promise<string>;
    /** Grava a ordem dos itens (requisições e pastas) de uma mesma pasta, na ordem recebida. */
    reorder(collectionId: EntityId, entries: string[]): Promise<void>;
    /** Envia para a lixeira do sistema. */
    remove(collectionId: EntityId, path: string): Promise<void>;
    /** Mostra o item no gerenciador de arquivos do sistema ('' = a pasta da coleção). */
    reveal(collectionId: EntityId, path: string): Promise<void>;
}

export interface EventsApi {
    /** Registra um listener para ações do menu/tray. Retorna a função para remover o listener. */
    onMenuAction(listener: (action: MenuAction) => void): () => void;
}

/** Atualizações publicadas no GitHub Releases (sempre dentro do canal da instalação: beta ou final). */
export interface UpdatesApi {
    state(): Promise<UpdateState>;
    /** Verificação manual: ignora "skip" e "remind later". */
    check(): Promise<UpdateState>;
    download(): Promise<void>;
    /** Fecha o app (confirmando alterações pendentes), instala e reabre. */
    install(): Promise<void>;
    skip(version: string): Promise<void>;
    remindLater(): Promise<void>;
    clearSkipped(): Promise<void>;
    openRelease(): Promise<void>;
    onStateChanged(listener: (state: UpdateState) => void): () => void;
    onOpenRequested(listener: () => void): () => void;
}

export interface OttoApi extends EventsApi {
    readonly isElectron: true;
    readonly platform: string;
    readonly app: AppApi;
    readonly window: WindowApi;
    readonly settings: SettingsApi;
    readonly theme: ThemeApi;
    readonly keybindings: KeybindingsApi;
    readonly http: HttpApi;
    readonly dialog: DialogApi;
    readonly history: HistoryApi;
    readonly tabs: TabsApi;
    readonly workspaces: WorkspacesApi;
    readonly environments: EnvironmentsApi;
    readonly collections: CollectionsApi;
    readonly collectionFiles: CollectionFilesApi;
    readonly openapi: OpenApiApi;
    readonly updates: UpdatesApi;
}
