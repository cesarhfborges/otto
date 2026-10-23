import { app, shell } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isBetaVersion, type UpdateInfoView, type UpdateMode, type UpdateState } from '../../../shared/models';
import { isBeta, REPOSITORY_URL } from '../../config';
import type { ISettingsService } from '../../core/contracts';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 10_000;
const REMIND_LATER_MS = 24 * 60 * 60 * 1000;

/** Escolhas do usuário sobre um aviso (fora das settings: não são preferências editáveis). */
interface UpdatePrompts {
    skippedVersion: string;
    /** ISO; o aviso fica suprimido até essa data. */
    remindAfter: string;
}

const detectMode = (): UpdateMode => {
    if (!app.isPackaged) {
        return 'disabled';
    }

    if (process.platform === 'win32' || (process.platform === 'linux' && process.env['APPIMAGE'])) {
        return 'auto';
    }

    // deb e macOS (sem assinatura) não se atualizam sozinhos: só avisam.
    return 'notify-only';
};

const releaseNotesOf = (info: UpdateInfo): string => {
    const notes = info.releaseNotes;

    if (Array.isArray(notes)) {
        return notes.map((note) => note.note ?? '').join('\n');
    }

    return notes ?? '';
};

/**
 * Verifica e aplica atualizações publicadas no GitHub Releases (electron-updater).
 * Instalações beta só aceitam versões beta e instalações finais só aceitam versões
 * finais: são apps distintos (appId, nome e dados próprios) e não podem se substituir.
 */
export class UpdateService {
    private readonly listeners = new Set<(state: UpdateState) => void>();
    private readonly promptsFile = path.join(app.getPath('userData'), 'update-prompts.json');
    private prompts: UpdatePrompts = { skippedVersion: '', remindAfter: '' };
    private timer: NodeJS.Timeout | null = null;
    /** Verificação pedida pelo usuário: ignora "skip"/"remind later" e mostra erros. */
    private manual = false;
    private state: UpdateState = {
        phase: 'idle',
        mode: detectMode(),
        channel: isBeta ? 'beta' : 'stable',
        currentVersion: app.getVersion(),
        info: null,
        progress: null,
        error: null,
        lastCheckedAt: null,
        skippedVersion: ''
    };

    constructor(private readonly settings: ISettingsService) {
        this.prompts = this.readPrompts();
        this.state.skippedVersion = this.prompts.skippedVersion;
    }

    get current(): UpdateState {
        return this.state;
    }

    onChange(listener: (state: UpdateState) => void): () => void {
        this.listeners.add(listener);

        return () => this.listeners.delete(listener);
    }

    start(): void {
        if (this.state.mode === 'disabled') {
            return;
        }

        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowDowngrade = false;
        // Beta: lê o canal `beta` (pre-releases); final: só `latest` (releases não marcadas como pre-release).
        autoUpdater.allowPrerelease = isBeta;
        autoUpdater.channel = isBeta ? 'beta' : 'latest';

        autoUpdater.on('checking-for-update', () => this.patch({ phase: 'checking', error: null }));
        autoUpdater.on('update-available', (info) => this.onAvailable(info));
        autoUpdater.on('update-not-available', () => this.patch({ phase: 'not-available', info: null, lastCheckedAt: new Date().toISOString() }));
        autoUpdater.on('download-progress', (progress: ProgressInfo) =>
            this.patch({ phase: 'downloading', progress: { percent: progress.percent, transferred: progress.transferred, total: progress.total, bytesPerSecond: progress.bytesPerSecond } })
        );
        autoUpdater.on('update-downloaded', () => this.patch({ phase: 'downloaded', progress: null }));
        autoUpdater.on('error', (error) => this.onError(error));

        setTimeout(() => this.autoCheck(), FIRST_CHECK_DELAY_MS);
        this.timer = setInterval(() => this.autoCheck(), CHECK_INTERVAL_MS);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async check(): Promise<UpdateState> {
        if (this.state.mode === 'disabled' || this.state.phase === 'checking' || this.state.phase === 'downloading' || this.state.phase === 'downloaded') {
            return this.state;
        }

        this.manual = true;
        await this.runCheck();

        return this.state;
    }

    async download(): Promise<void> {
        if (this.state.mode !== 'auto' || this.state.phase !== 'available') {
            return;
        }

        this.patch({ phase: 'downloading', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } });

        try {
            await autoUpdater.downloadUpdate();
        } catch (error) {
            this.onError(error);
        }
    }

    /** Fecha o app e instala. A saída passa pelo `before-quit`, que confirma alterações não salvas. */
    install(): void {
        if (this.state.phase === 'downloaded') {
            autoUpdater.quitAndInstall(false, true);
        }
    }

    skip(version: string): void {
        this.savePrompts({ ...this.prompts, skippedVersion: version });
        this.dismiss();
    }

    remindLater(): void {
        this.savePrompts({ ...this.prompts, remindAfter: new Date(Date.now() + REMIND_LATER_MS).toISOString() });
        this.dismiss();
    }

    clearSkipped(): void {
        this.savePrompts({ ...this.prompts, skippedVersion: '' });
        this.patch({});
    }

    openReleasePage(): void {
        void shell.openExternal(this.state.info?.releaseUrl ?? `${REPOSITORY_URL}/releases`);
    }

    private autoCheck(): void {
        if (this.settings.get().updates.autoCheck && (this.state.phase === 'idle' || this.state.phase === 'not-available' || this.state.phase === 'error')) {
            this.manual = false;
            void this.runCheck();
        }
    }

    private async runCheck(): Promise<void> {
        try {
            await autoUpdater.checkForUpdates();
        } catch (error) {
            this.onError(error);
        }
    }

    private onAvailable(info: UpdateInfo): void {
        const view: UpdateInfoView = {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: releaseNotesOf(info),
            releaseUrl: `${REPOSITORY_URL}/releases/tag/v${info.version}`
        };
        const lastCheckedAt = new Date().toISOString();

        // Nunca cruza canais: beta → final (ou o contrário) trocaria o app instalado por outro.
        if (isBetaVersion(info.version) !== isBeta) {
            this.patch({ phase: 'not-available', info: null, lastCheckedAt });

            return;
        }

        const suppressed = info.version === this.prompts.skippedVersion || (this.prompts.remindAfter !== '' && Date.now() < Date.parse(this.prompts.remindAfter));

        if (suppressed && !this.manual) {
            this.patch({ phase: 'not-available', info: view, lastCheckedAt });

            return;
        }

        this.patch({ phase: 'available', info: view, lastCheckedAt, error: null });

        if (this.state.mode === 'auto' && this.settings.get().updates.autoDownload) {
            void this.download();
        }
    }

    private onError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);

        console.warn('[otto] update check failed:', message);
        // Falhas da verificação automática (rede, GitHub fora) não incomodam o usuário.
        this.patch(this.manual || this.state.phase === 'downloading' ? { phase: 'error', error: message, progress: null } : { phase: 'idle', progress: null });
    }

    /** Some com o aviso atual, mantendo a versão encontrada para a tela de Preferences. */
    private dismiss(): void {
        if (this.state.phase === 'available') {
            this.patch({ phase: 'not-available' });
        } else {
            this.patch({});
        }
    }

    private patch(changes: Partial<UpdateState>): void {
        this.state = { ...this.state, ...changes, skippedVersion: this.prompts.skippedVersion };

        for (const listener of this.listeners) {
            listener(this.state);
        }
    }

    private readPrompts(): UpdatePrompts {
        try {
            const raw = JSON.parse(fs.readFileSync(this.promptsFile, 'utf8')) as Partial<UpdatePrompts>;

            return {
                skippedVersion: typeof raw.skippedVersion === 'string' ? raw.skippedVersion : '',
                remindAfter: typeof raw.remindAfter === 'string' ? raw.remindAfter : ''
            };
        } catch {
            return { skippedVersion: '', remindAfter: '' };
        }
    }

    private savePrompts(prompts: UpdatePrompts): void {
        this.prompts = prompts;

        try {
            fs.writeFileSync(this.promptsFile, JSON.stringify(prompts));
        } catch (error) {
            console.warn('[otto] could not save update preferences:', error);
        }
    }
}
