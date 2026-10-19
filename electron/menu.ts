import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME, isDev, isMac, REPOSITORY_URL } from './config';
import { pickCollectionFolder, showAboutDialog } from './dialogs';
import { sendMenuAction } from './window';

export async function openCollection(): Promise<void> {
    const folder = await pickCollectionFolder();

    if (folder) {
        sendMenuAction({ type: 'open-collection', path: folder });
    }
}

export function buildAppMenu(): Menu {
    const separator: MenuItemConstructorOptions = { type: 'separator' };

    const template: MenuItemConstructorOptions[] = [
        ...(isMac
            ? [
                  {
                      label: APP_NAME,
                      submenu: [{ role: 'about' }, separator, { role: 'services' }, separator, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, separator, { role: 'quit' }]
                  } satisfies MenuItemConstructorOptions
              ]
            : []),
        {
            label: 'File',
            submenu: [
                { label: 'New Request', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction({ type: 'new-request' }) },
                { label: 'New Collection', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendMenuAction({ type: 'new-collection' }) },
                { label: 'Open Collection…', accelerator: 'CmdOrCtrl+O', click: () => void openCollection() },
                separator,
                { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction({ type: 'save' }) },
                separator,
                isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => app.quit() }
            ]
        },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                ...(isDev ? [{ role: 'toggleDevTools' } satisfies MenuItemConstructorOptions] : []),
                separator,
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                separator,
                { label: 'Toggle Dark Mode', accelerator: 'CmdOrCtrl+Shift+D', click: () => sendMenuAction({ type: 'toggle-theme' }) },
                { role: 'togglefullscreen' }
            ]
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                { label: 'Documentation', click: () => void shell.openExternal(`${REPOSITORY_URL}#readme`) },
                { label: 'Report an Issue', click: () => void shell.openExternal(`${REPOSITORY_URL}/issues`) },
                ...(isMac ? [] : [separator, { label: `About ${APP_NAME}`, click: () => void showAboutDialog() } satisfies MenuItemConstructorOptions])
            ]
        }
    ];

    return Menu.buildFromTemplate(template);
}
