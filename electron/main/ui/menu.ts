import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME, isDev, isMac, REPOSITORY_URL } from '../config';
import type { AppCommands } from './commands';

export function buildAppMenu(commands: AppCommands): Menu {
    const separator: MenuItemConstructorOptions = { type: 'separator' };

    const template: MenuItemConstructorOptions[] = [
        ...(isMac
            ? [
                  {
                      label: APP_NAME,
                      submenu: [
                          { role: 'about' },
                          separator,
                          { label: 'Settings…', accelerator: 'Cmd+,', click: () => commands.openSettings() },
                          separator,
                          { role: 'services' },
                          separator,
                          { role: 'hide' },
                          { role: 'hideOthers' },
                          { role: 'unhide' },
                          separator,
                          { role: 'quit' }
                      ]
                  } satisfies MenuItemConstructorOptions
              ]
            : []),
        {
            label: 'File',
            submenu: [
                { label: 'New Request', accelerator: 'CmdOrCtrl+N', click: () => commands.newRequest() },
                { label: 'New Collection', accelerator: 'CmdOrCtrl+Shift+N', click: () => commands.newCollection() },
                { label: 'Import Collection…', accelerator: 'CmdOrCtrl+O', click: () => commands.importCollection() },
                separator,
                { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => commands.save() },
                separator,
                ...(isMac ? [] : [{ label: 'Settings…', accelerator: 'Ctrl+,', click: () => commands.openSettings() } satisfies MenuItemConstructorOptions, separator]),
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
                { label: 'Toggle Dark Mode', accelerator: 'CmdOrCtrl+Shift+D', click: () => commands.toggleTheme() },
                { role: 'togglefullscreen' }
            ]
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                { label: 'Documentation', click: () => void shell.openExternal(`${REPOSITORY_URL}#readme`) },
                { label: 'Report an Issue', click: () => void shell.openExternal(`${REPOSITORY_URL}/issues`) },
                ...(isMac ? [] : [separator, { label: `About ${APP_NAME}`, click: () => commands.showAbout() } satisfies MenuItemConstructorOptions])
            ]
        }
    ];

    return Menu.buildFromTemplate(template);
}
