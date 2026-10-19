/**
 * Contrato de IPC compartilhado entre o processo main, o preload e o Angular.
 *
 * Contém apenas tipos: o preload roda em sandbox e não pode importar módulos
 * locais em tempo de execução, por isso os canais são uniões de string literais.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface HttpRequest {
    /** Identificador gerado pelo renderer, usado para cancelar a requisição. */
    id: string;
    method: HttpMethod;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}

export interface HttpResponse {
    url: string;
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
    body: string;
    /** Tamanho do corpo em bytes. */
    size: number;
    /** Tempo total (até o fim do download do corpo) em milissegundos. */
    timeMs: number;
}

export type HttpResult = { ok: true; response: HttpResponse } | { ok: false; error: string; timeMs: number };

export type MenuAction = { type: 'new-request' } | { type: 'new-collection' } | { type: 'open-collection'; path: string } | { type: 'save' } | { type: 'toggle-theme' };

export interface AppInfo {
    name: string;
    version: string;
    platform: string;
    versions: { electron: string; chrome: string; node: string };
}

export interface OttoSettings {
    /** Ao fechar a janela, mantém o Otto rodando na bandeja do sistema. */
    minimizeToTray: boolean;
}

/** Canais acessados via ipcRenderer.invoke / ipcMain.handle. */
export type IpcInvokeChannel = 'app:info' | 'settings:get' | 'settings:set' | 'http:send' | 'http:cancel' | 'dialog:open-collection';

/** Canais de eventos enviados do main para o renderer. */
export type IpcEventChannel = 'menu:action';

/** API exposta em `window.otto` pelo preload. */
export interface OttoApi {
    readonly isElectron: true;
    readonly platform: string;
    app: {
        info(): Promise<AppInfo>;
    };
    settings: {
        get(): Promise<OttoSettings>;
        set(patch: Partial<OttoSettings>): Promise<OttoSettings>;
    };
    http: {
        send(request: HttpRequest): Promise<HttpResult>;
        cancel(id: string): Promise<boolean>;
    };
    dialog: {
        openCollection(): Promise<string | null>;
    };
    /** Registra um listener para ações do menu/tray. Retorna a função para remover o listener. */
    onMenuAction(listener: (action: MenuAction) => void): () => void;
}
