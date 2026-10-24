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

/** Ações disparadas pelo menu da aplicação ou pelo tray e encaminhadas ao renderer. */
export type MenuAction = { type: 'command'; id: CommandId };

/** Estado da janela principal, usado pela barra de título própria (janela sem moldura). */
export interface WindowState {
    maximized: boolean;
    fullScreen: boolean;
}
