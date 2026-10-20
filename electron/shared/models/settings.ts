export const THEME_MODES = ['light', 'dark', 'auto'] as const;

/** Aparência: `auto` acompanha o tema do sistema operacional (`nativeTheme`). */
export type ThemeMode = (typeof THEME_MODES)[number];

export type EffectiveTheme = 'light' | 'dark';

/** Preferência do usuário e o tema efetivamente aplicado (resolvido pelo main). */
export interface ThemeState {
    mode: ThemeMode;
    effective: EffectiveTheme;
}

export interface ProxySettings {
    enabled: boolean;
    /** URL do proxy HTTP(S), ex.: `http://proxy.local:3128`. */
    url: string;
    /** Hosts que não passam pelo proxy, separados por vírgula (ex.: `localhost, *.internal`). */
    bypass: string;
}

export interface SslSettings {
    /** Desligar aceita certificados autoassinados/inválidos (útil em dev, inseguro em produção). */
    verifyCertificates: boolean;
    /** Caminho absoluto de um certificado de CA adicional (PEM), ou `null`. */
    caCertificatePath: string | null;
}

export interface HttpSettings {
    /** Timeout padrão das requisições em ms; `0` desativa. */
    timeoutMs: number;
    followRedirects: boolean;
    proxy: ProxySettings;
    ssl: SslSettings;
}

export interface HistorySettings {
    /** Quantas execuções manter no histórico (as mais antigas são apagadas); `0` desliga o registro. */
    maxEntries: number;
}

export interface WorkspaceSettings {
    /**
     * Pasta base onde ficam os workspaces (`<base>/<workspace>/collections/<coleção>`).
     * Vazio = padrão do sistema (`Documentos/otto`, informado pelo main em `AppInfo`).
     */
    baseDirectory: string;
}

/** Disposição dos painéis da requisição: lado a lado (`horizontal`) ou empilhados (`vertical`). */
export const REQUEST_LAYOUTS = ['horizontal', 'vertical'] as const;

export type RequestLayout = (typeof REQUEST_LAYOUTS)[number];

/** Paletas de realce de sintaxe (highlight.js) dos editores de corpo e da resposta. */
export const CODE_THEMES = ['github', 'atom-one', 'monokai', 'dracula', 'solarized', 'nord', 'vs-code', 'tokyo-night', 'catppuccin', 'material', 'synthwave-84', 'gruvbox', 'seneca'] as const;

export type CodeTheme = (typeof CODE_THEMES)[number];

export const MIN_CODE_FONT_SIZE = 10;
export const MAX_CODE_FONT_SIZE = 24;

export interface AppearanceSettings {
    requestLayout: RequestLayout;
    codeTheme: CodeTheme;
    /** Tamanho da fonte (px) dos editores de corpo e da resposta. */
    codeFontSize: number;
}

export interface OttoSettings {
    /** Ao fechar a janela, mantém o Otto rodando na bandeja do sistema. */
    minimizeToTray: boolean;
    hardwareAcceleration: boolean;
    theme: ThemeMode;
    http: HttpSettings;
    history: HistorySettings;
    workspaces: WorkspaceSettings;
    appearance: AppearanceSettings;
}

/** Alteração parcial, em qualquer nível de profundidade. */
export interface SettingsPatch {
    minimizeToTray?: boolean;
    theme?: ThemeMode;
    http?: {
        timeoutMs?: number;
        followRedirects?: boolean;
        proxy?: Partial<ProxySettings>;
        ssl?: Partial<SslSettings>;
    };
    history?: Partial<HistorySettings>;
    workspaces?: Partial<WorkspaceSettings>;
    appearance?: Partial<AppearanceSettings>;
}

export const MAX_TIMEOUT_MS = 3_600_000;
export const MAX_HISTORY_ENTRIES = 10_000;

export const DEFAULT_SETTINGS: Readonly<OttoSettings> = {
    minimizeToTray: true,
    hardwareAcceleration: true,
    theme: 'auto',
    http: {
        timeoutMs: 30_000,
        followRedirects: true,
        proxy: { enabled: false, url: '', bypass: 'localhost, 127.0.0.1' },
        ssl: { verifyCertificates: true, caCertificatePath: null }
    },
    history: { maxEntries: 500 },
    workspaces: { baseDirectory: '' },
    appearance: { requestLayout: 'horizontal', codeTheme: 'seneca', codeFontSize: 14 }
};
