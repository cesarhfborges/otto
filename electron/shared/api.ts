/**
 * API exposta em `window.otto` pelo preload, segregada por responsabilidade (ISP):
 * cada consumidor no Angular depende apenas da fatia que usa.
 */
import type { AppInfo, CollectionMetadata, EntityId, Environment, HistoryEntry, HistoryQuery, HttpRequest, HttpResult, MenuAction, NewCollectionMetadata, NewEnvironment, OttoSettings, SettingsPatch, TabState, ThemeState } from './models';

export interface AppApi {
    info(): Promise<AppInfo>;
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
    delete(id: EntityId): Promise<boolean>;
}

export interface EventsApi {
    /** Registra um listener para ações do menu/tray. Retorna a função para remover o listener. */
    onMenuAction(listener: (action: MenuAction) => void): () => void;
}

export interface OttoApi extends EventsApi {
    readonly isElectron: true;
    readonly platform: string;
    readonly app: AppApi;
    readonly settings: SettingsApi;
    readonly theme: ThemeApi;
    readonly http: HttpApi;
    readonly dialog: DialogApi;
    readonly history: HistoryApi;
    readonly tabs: TabsApi;
    readonly environments: EnvironmentsApi;
    readonly collections: CollectionsApi;
}
