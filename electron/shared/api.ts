/**
 * API exposta em `window.otto` pelo preload, segregada por responsabilidade (ISP):
 * cada consumidor no Angular depende apenas da fatia que usa.
 */
import type {
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
    MenuAction,
    NewCollectionMetadata,
    NewEnvironment,
    OttoSettings,
    SettingsPatch,
    TabState,
    ThemeState,
    WindowState
} from './models';

export interface AppApi {
    info(): Promise<AppInfo>;
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

export interface HttpApi {
    send(request: HttpRequest): Promise<HttpResult>;
    cancel(id: string): Promise<boolean>;
}

export interface DialogApi {
    /** Abre o seletor de pastas e retorna o caminho escolhido, ou `null` se cancelado. */
    openCollection(): Promise<string | null>;
    /** Seletor de arquivo de certificado (PEM/CRT). */
    pickCertificate(): Promise<string | null>;
    /** Escolhe a pasta onde uma nova coleção será criada. */
    chooseCollectionLocation(): Promise<string | null>;
}

export interface HistoryApi {
    list(query?: HistoryQuery): Promise<HistoryEntry[]>;
    delete(id: EntityId): Promise<boolean>;
    /** Retorna quantos registros foram removidos. */
    clear(): Promise<number>;
}

export interface TabsApi {
    list(): Promise<TabState[]>;
    /** Substitui o conjunto de abas persistidas. */
    save(tabs: TabState[]): Promise<void>;
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
    /** Abre uma pasta que contenha `otto.yaml`, registrando-a no banco. */
    open(directory: string): Promise<OpenedCollection>;
    /** Cria `parentDirectory/<nome>` com o manifesto e abre a coleção. */
    createOnDisk(parentDirectory: string, name: string): Promise<OpenedCollection>;
    close(id: EntityId): Promise<void>;
    tree(id: EntityId): Promise<CollectionTree>;
    /** Disparado quando arquivos da coleção mudam (pelo app, git, editor...). */
    onChanged(listener: (event: { collectionId: EntityId }) => void): () => void;
}

/** Arquivos dentro de uma coleção. Caminhos são relativos à raiz e usam `/`. */
export interface CollectionFilesApi {
    readRequest(collectionId: EntityId, path: string): Promise<RequestDefinition>;
    saveRequest(collectionId: EntityId, path: string, request: RequestDefinition): Promise<void>;
    /** Cria um arquivo com nome derivado de `request.name`; retorna o caminho criado. */
    createRequest(collectionId: EntityId, folder: string, request: RequestDefinition): Promise<string>;
    createFolder(collectionId: EntityId, parent: string, name: string): Promise<string>;
    move(collectionId: EntityId, from: string, to: string): Promise<void>;
    /** Envia para a lixeira do sistema. */
    remove(collectionId: EntityId, path: string): Promise<void>;
}

export interface EventsApi {
    /** Registra um listener para ações do menu/tray. Retorna a função para remover o listener. */
    onMenuAction(listener: (action: MenuAction) => void): () => void;
}

export interface OttoApi extends EventsApi {
    readonly isElectron: true;
    readonly platform: string;
    readonly app: AppApi;
    readonly window: WindowApi;
    readonly settings: SettingsApi;
    readonly theme: ThemeApi;
    readonly http: HttpApi;
    readonly dialog: DialogApi;
    readonly history: HistoryApi;
    readonly tabs: TabsApi;
    readonly environments: EnvironmentsApi;
    readonly collections: CollectionsApi;
    readonly collectionFiles: CollectionFilesApi;
}
