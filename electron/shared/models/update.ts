/**
 * Como esta instalação recebe atualizações:
 * - `auto`: baixa e instala sozinho (AppImage, instalador do Windows);
 * - `notify-only`: só avisa e abre a página da release (deb, macOS);
 * - `disabled`: build de desenvolvimento.
 */
export type UpdateMode = 'auto' | 'notify-only' | 'disabled';

/** Canal da instalação: builds beta só recebem betas; builds finais só recebem versões finais. */
export type UpdateChannel = 'stable' | 'beta';

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateInfoView {
    version: string;
    releaseDate: string;
    /** Notas da release do GitHub (HTML gerado a partir do changelog). */
    releaseNotes: string;
    releaseUrl: string;
}

export interface UpdateProgress {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
}

export interface UpdateState {
    phase: UpdatePhase;
    mode: UpdateMode;
    channel: UpdateChannel;
    currentVersion: string;
    /** Versão encontrada (também em `not-available` quando foi pulada ou adiada). */
    info: UpdateInfoView | null;
    progress: UpdateProgress | null;
    error: string | null;
    lastCheckedAt: string | null;
    /** Versão marcada com "Skip this version" (vazio = nenhuma). */
    skippedVersion: string;
}

export const isBetaVersion = (version: string): boolean => version.includes('-beta');
