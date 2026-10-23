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

/** Estilo base do PrimeNG (`@primeuix/themes`). */
export const THEME_PRESETS = ['aura', 'lara', 'nora'] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

/** Cor de destaque: `noir` usa a própria paleta de superfície (monocromático). */
export const PRIMARY_COLORS = ['noir', 'emerald', 'green', 'lime', 'orange', 'amber', 'yellow', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'] as const;

export type PrimaryColor = (typeof PRIMARY_COLORS)[number];

/** Tons de cinza de fundos e painéis. */
export const SURFACE_COLORS = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'soho', 'viva', 'ocean'] as const;

export type SurfaceColor = (typeof SURFACE_COLORS)[number];

export interface AppearanceSettings {
    themePreset: ThemePreset;
    primaryColor: PrimaryColor;
    /** `null` = tons padrão do estilo base (slate no claro, zinc no escuro). */
    surfaceColor: SurfaceColor | null;
    requestLayout: RequestLayout;
    /** Mostra a query dos params (somente leitura, colorida) depois da URL da requisição. */
    showQueryInUrl: boolean;
    codeTheme: CodeTheme;
    /** Tamanho da fonte (px) dos editores de corpo e da resposta. */
    codeFontSize: number;
}

export interface UpdateSettings {
    /** Verifica novas versões ao iniciar e a cada 6 h. Desligado = "Never update" (só "Check now"). */
    autoCheck: boolean;
    /** Baixa a nova versão em segundo plano assim que ela é encontrada. */
    autoDownload: boolean;
}

export interface OttoSettings {
    /** Exibe o ícone do Otto na bandeja do sistema. */
    showTrayIcon: boolean;
    /** Ao fechar a janela, mantém o Otto rodando na bandeja do sistema (exige `showTrayIcon`). */
    minimizeToTray: boolean;
    /** Renderização pela GPU. Lido só na inicialização: a mudança vale após reiniciar o app. */
    hardwareAcceleration: boolean;
    theme: ThemeMode;
    http: HttpSettings;
    workspaces: WorkspaceSettings;
    appearance: AppearanceSettings;
    updates: UpdateSettings;
}

/** Alteração parcial, em qualquer nível de profundidade. */
export interface SettingsPatch {
    showTrayIcon?: boolean;
    minimizeToTray?: boolean;
    hardwareAcceleration?: boolean;
    theme?: ThemeMode;
    http?: {
        timeoutMs?: number;
        followRedirects?: boolean;
        proxy?: Partial<ProxySettings>;
        ssl?: Partial<SslSettings>;
    };
    workspaces?: Partial<WorkspaceSettings>;
    appearance?: Partial<AppearanceSettings>;
    updates?: Partial<UpdateSettings>;
}

export const MAX_TIMEOUT_MS = 3_600_000;

export const DEFAULT_SETTINGS: Readonly<OttoSettings> = {
    showTrayIcon: false,
    minimizeToTray: false,
    hardwareAcceleration: true,
    theme: 'auto',
    http: {
        timeoutMs: 30_000,
        followRedirects: true,
        proxy: { enabled: false, url: '', bypass: 'localhost, 127.0.0.1' },
        ssl: { verifyCertificates: true, caCertificatePath: null }
    },
    workspaces: { baseDirectory: '' },
    appearance: { themePreset: 'aura', primaryColor: 'emerald', surfaceColor: null, requestLayout: 'horizontal', showQueryInUrl: true, codeTheme: 'seneca', codeFontSize: 14 },
    updates: { autoCheck: true, autoDownload: false }
};
