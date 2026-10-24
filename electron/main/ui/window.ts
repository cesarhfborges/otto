import { app, BrowserWindow, Menu, nativeTheme, screen, shell, type Rectangle } from 'electron';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import type { IpcEventChannel, IpcEventContract } from '../../shared/ipc';
import type { MenuAction, WindowState } from '../../shared/models';
import { APP_NAME, assetPath, isDev, isMac, rendererIndexPath, rendererUrl } from '../config';
import type { IRendererNotifier, ISettingsStore, IWindowStateStore } from '../core/contracts';
import { WINDOW_BACKGROUND } from './theme';

const DEFAULT_SIZE = { width: 1280, height: 800 };

const isOnSomeDisplay = (bounds: Rectangle): boolean => screen.getAllDisplays().some(({ workArea: a }) => bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y);

const isExternalUrl = (url: string): boolean => (isDev ? !url.startsWith(rendererUrl) : !url.startsWith('file://'));

/** Ciclo de vida da janela principal: criação, posição, minimizar para o tray e envio de ações ao renderer. */
export class WindowManager implements IRendererNotifier {
    /** Emite `visibility-changed` sempre que a janela é exibida ou ocultada (usado pelo tray). */
    readonly events = new EventEmitter<{ 'visibility-changed': [] }>();

    private window: BrowserWindow | null = null;
    private quitting = false;
    /** O renderer já liberou a saída (sem alterações pendentes ou descartadas). */
    private quitConfirmed = false;
    private trayAvailable = false;

    constructor(
        private readonly settings: ISettingsStore,
        private readonly windowState: IWindowStateStore
    ) {}

    get current(): BrowserWindow | null {
        return this.window;
    }

    get isVisible(): boolean {
        return !!this.window && this.window.isVisible() && !this.window.isMinimized();
    }

    /**
     * Saída real do app. Retorna `true` se pode sair já; senão, pede ao renderer para
     * confirmar alterações pendentes (ele chama `confirmQuit`). Sem renderer utilizável, sai.
     */
    requestQuit(): boolean {
        const contents = this.window?.webContents;

        if (this.quitConfirmed || !contents || contents.isDestroyed() || contents.isLoading() || contents.isCrashed()) {
            return true;
        }

        // Saindo pela bandeja, a janela pode estar oculta: o aviso precisa aparecer.
        this.show();
        contents.send('app:quit-requested', null);

        return false;
    }

    confirmQuit(): void {
        this.quitConfirmed = true;
        app.quit();
    }

    markQuitting(): void {
        this.quitting = true;
    }

    setTrayAvailable(available: boolean): void {
        this.trayAvailable = available;
    }

    create(): BrowserWindow {
        const saved = this.windowState.getBounds();
        const bounds = saved && isOnSomeDisplay(saved) ? saved : DEFAULT_SIZE;
        const win = new BrowserWindow({
            ...bounds,
            minWidth: 900,
            minHeight: 600,
            title: APP_NAME,
            icon: assetPath('icons', 'icon.png'),
            show: false,
            frame: false,
            // Sem moldura nativa: a barra de título é desenhada pelo Angular (estilo Bruno).
            // No macOS mantemos os botões "semáforo" nativos sobre a nossa barra.
            ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } } : { frame: false }),
            autoHideMenuBar: true,
            backgroundColor: nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light,
            webPreferences: {
                // Lido pelo preload para aplicar o tema escuro antes do Angular inicializar.
                additionalArguments: [`--otto-dark=${nativeTheme.shouldUseDarkColors ? 1 : 0}`],
                preload: path.join(__dirname, '..', '..', 'preload', 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                // Visualizador de PDF do Chromium (prévia de respostas application/pdf).
                plugins: true
            }
        });

        this.window = win;
        win.once('ready-to-show', () => win.show());

        // Links externos abrem no navegador padrão; o app nunca navega para fora.
        win.webContents.setWindowOpenHandler(({ url }) => {
            if (/^https?:\/\//.test(url)) {
                void shell.openExternal(url);
            }

            return { action: 'deny' };
        });

        win.webContents.on('will-navigate', (event, url) => {
            if (isExternalUrl(url)) {
                event.preventDefault();
            }
        });

        for (const evt of ['show', 'hide', 'minimize', 'restore'] as const) {
            win.on(evt as 'show', () => this.events.emit('visibility-changed'));
        }

        win.on('close', (event) => {
            if (!win.isMinimized() && !win.isFullScreen()) {
                this.windowState.setBounds(win.getNormalBounds());
            }

            const keepInTray = isMac || (this.trayAvailable && this.settings.get().minimizeToTray);

            if (!this.quitting && keepInTray) {
                event.preventDefault();
                win.hide();
            } else if (!this.quitting && !this.requestQuit()) {
                // Fechar a janela encerra o app: antes, confirma as alterações pendentes.
                event.preventDefault();
            }
        });

        // Clique direito na área arrastável da barra de título própria abriria o menu de janela
        // do sistema, que numa janela sem moldura fica preso na tela (não fecha nem executa nada).
        win.on('system-context-menu', (event) => event.preventDefault());

        for (const evt of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
            win.on(evt as 'maximize', () => this.notify('window:state-changed', this.state()));
        }

        win.on('closed', () => {
            this.window = null;
            this.events.emit('visibility-changed');
        });

        if (isDev) {
            void win.loadURL(rendererUrl);
            win.webContents.openDevTools({ mode: 'detach' });
        } else {
            void win.loadFile(rendererIndexPath());
        }

        return win;
    }

    show(): BrowserWindow {
        const win = this.window ?? this.create();

        if (win.isMinimized()) {
            win.restore();
        }

        win.show();
        win.focus();

        return win;
    }

    toggle(): void {
        if (this.isVisible && this.window?.isFocused()) {
            this.window.hide();
        } else {
            this.show();
        }
    }

    state(): WindowState {
        return { maximized: !!this.window?.isMaximized(), fullScreen: !!this.window?.isFullScreen() };
    }

    minimize(): void {
        this.window?.minimize();
    }

    toggleMaximize(): void {
        if (!this.window) {
            return;
        }

        if (this.window.isMaximized()) {
            this.window.unmaximize();
        } else {
            this.window.maximize();
        }
    }

    /** Mesmo caminho do botão nativo: dispara `close`, que respeita "manter na bandeja". */
    close(): void {
        this.window?.close();
    }

    /** Menu da aplicação (com os atalhos) como popup, já que a janela não tem barra de menu. */
    showAppMenu(x: number, y: number): void {
        const win = this.window;

        if (win) {
            Menu.getApplicationMenu()?.popup({ window: win, x: Math.round(x), y: Math.round(y) });
        }
    }

    /**
     * Envia um evento ao renderer, se a janela existir. Durante o carregamento o
     * evento é descartado: o Angular busca o estado atual ao inicializar.
     */
    notify<C extends IpcEventChannel>(channel: C, payload: IpcEventContract[C]): void {
        const contents = this.window?.webContents;

        if (contents && !contents.isDestroyed() && !contents.isLoading()) {
            contents.send(channel, payload);
        }
    }

    /** Exibe a janela e encaminha a ação para o Angular. */
    sendMenuAction(action: MenuAction): void {
        const win = this.show();
        const send = () => win.webContents.send('menu:action', action);

        if (win.webContents.isLoading()) {
            win.webContents.once('did-finish-load', send);
        } else {
            send();
        }
    }
}
