import type { CommandId } from './keybindings';

export interface AppInfo {
    name: string;
    version: string;
    platform: string;
    versions: { electron: string; chrome: string; node: string };
    /** Pasta base usada quando a preferência `workspaces.baseDirectory` está vazia. */
    defaultBaseDirectory: string;
    /** Se a GPU foi habilitada nesta execução (a preferência só é aplicada ao iniciar). */
    hardwareAcceleration: boolean;
    /**
     * Onde os valores secretos dos ambientes são cifrados: chaveiro do sistema (`os`),
     * chave fixa do Electron quando não há chaveiro (`basic`, só ofusca) ou indisponível.
     */
    secretStorage: 'os' | 'basic' | 'unavailable';
}

/**
 * Atalho do menu de aplicativos no Linux (`.desktop`).
 * - `unsupported`: fora do Linux ou rodando sem empacotar (dev).
 * - `missing`: não há atalho; pode ser criado em `~/.local/share/applications`.
 * - `installed`: atalho do usuário válido para esta execução.
 * - `invalid`: atalho do usuário com problemas (`issues`), por exemplo o AppImage mudou de lugar.
 * - `system`: atalho instalado pelo pacote `.deb` em `/usr/share/applications`.
 */
export interface DesktopEntryStatus {
    /** Como o app foi instalado: AppImage avulso ou pacote do sistema (`.deb`). */
    mode: 'appimage' | 'package' | null;
    state: 'unsupported' | 'missing' | 'installed' | 'invalid' | 'system';
    /** Arquivo `.desktop` encontrado (ou onde será criado, em `missing`). */
    path: string | null;
    /** Programa que o atalho deve executar. */
    executable: string | null;
    issues: string[];
}

/** Ações disparadas pelo menu da aplicação ou pelo tray e encaminhadas ao renderer. */
export type MenuAction = { type: 'command'; id: CommandId };

/** Estado da janela principal, usado pela barra de título própria (janela sem moldura). */
export interface WindowState {
    maximized: boolean;
    fullScreen: boolean;
}
