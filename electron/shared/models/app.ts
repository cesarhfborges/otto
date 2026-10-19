export interface AppInfo {
    name: string;
    version: string;
    platform: string;
    versions: { electron: string; chrome: string; node: string };
}

/** Ações disparadas pelo menu da aplicação ou pelo tray e encaminhadas ao renderer. */
export type MenuAction = { type: 'new-request' } | { type: 'new-collection' } | { type: 'open-collection'; path: string } | { type: 'save' } | { type: 'toggle-theme' } | { type: 'open-settings' };
