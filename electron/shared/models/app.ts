export interface AppInfo {
    name: string;
    version: string;
    platform: string;
    versions: { electron: string; chrome: string; node: string };
    /** Pasta base usada quando a preferência `workspaces.baseDirectory` está vazia. */
    defaultBaseDirectory: string;
}

/** Ações disparadas pelo menu da aplicação ou pelo tray e encaminhadas ao renderer. */
export type MenuAction = { type: 'new-request' } | { type: 'new-collection' } | { type: 'import-collection' } | { type: 'save' } | { type: 'toggle-theme' } | { type: 'open-settings' };

/** Estado da janela principal, usado pela barra de título própria (janela sem moldura). */
export interface WindowState {
    maximized: boolean;
    fullScreen: boolean;
}
