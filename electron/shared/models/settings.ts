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

export interface OttoSettings {
    /** Ao fechar a janela, mantém o Otto rodando na bandeja do sistema. */
    minimizeToTray: boolean;
    theme: ThemeMode;
    http: HttpSettings;
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
}

export const MAX_TIMEOUT_MS = 3_600_000;

export const DEFAULT_SETTINGS: Readonly<OttoSettings> = {
    minimizeToTray: true,
    theme: 'auto',
    http: {
        timeoutMs: 30_000,
        followRedirects: true,
        proxy: { enabled: false, url: '', bypass: 'localhost, 127.0.0.1' },
        ssl: { verifyCertificates: true, caCertificatePath: null }
    }
};
