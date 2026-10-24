import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { toElectronAccelerator } from '../../shared/keyboard/chord';
import { commandMeta, effectiveChords, type CommandId, type KeybindingOverrides } from '../../shared/models';
import { APP_NAME, isDev, isMac, REPOSITORY_URL } from '../config';
import type { AppCommands } from './commands';

/**
 * Menu da aplicação. Os itens de comando mostram o atalho configurado pelo usuário,
 * mas não o registram (`registerAccelerator: false`): quem trata a tecla é o renderer,
 * que sabe o contexto (aba ativa, diálogo aberto...). O clique executa o mesmo comando.
 * Os papéis nativos (editar, zoom, sair) mantêm seus aceleradores, reservados no app.
 */
export function buildAppMenu(commands: AppCommands, overrides: KeybindingOverrides): Menu {
    const separator: MenuItemConstructorOptions = { type: 'separator' };
    const command = (id: CommandId, label: string): MenuItemConstructorOptions => {
        const chord = effectiveChords(commandMeta(id), overrides, isMac)[0];

        return { label, click: () => commands.run(id), ...(chord ? { accelerator: toElectronAccelerator(chord), registerAccelerator: false } : {}) };
    };

    const template: MenuItemConstructorOptions[] = [
        ...(isMac
            ? [
                  {
                      label: APP_NAME,
                      submenu: [{ role: 'about' }, separator, command('app.preferences', 'Settings…'), separator, { role: 'services' }, separator, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, separator, { role: 'quit' }]
                  } satisfies MenuItemConstructorOptions
              ]
            : []),
        {
            label: 'File',
            submenu: [
                command('collection.newRequest', 'New Request'),
                command('collection.new', 'New Collection'),
                command('collection.import', 'Import Collection…'),
                separator,
                command('request.save', 'Save'),
                command('request.saveAll', 'Save All'),
                separator,
                command('tabs.close', 'Close Tab'),
                command('tabs.reopenClosed', 'Reopen Closed Tab'),
                separator,
                ...(isMac ? [] : [command('app.preferences', 'Settings…'), separator]),
                isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => app.quit() }
            ]
        },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                command('app.commandPalette', 'Command Palette…'),
                separator,
                command('view.toggleSidebar', 'Toggle Sidebar'),
                command('view.toggleRequestLayout', 'Toggle Request Layout'),
                separator,
                { role: 'reload' },
                { role: 'forceReload' },
                ...(isDev ? [{ role: 'toggleDevTools' } satisfies MenuItemConstructorOptions] : []),
                separator,
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                separator,
                command('theme.cycle', 'Cycle Theme (Dark / Light / Auto)'),
                { role: 'togglefullscreen' }
            ]
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                command('app.shortcuts', 'Keyboard Shortcuts'),
                separator,
                { label: 'Check for Updates…', click: () => commands.checkForUpdates() },
                { label: 'Documentation', click: () => void shell.openExternal(`${REPOSITORY_URL}#readme`) },
                { label: 'Report an Issue', click: () => void shell.openExternal(`${REPOSITORY_URL}/issues`) },
                ...(isMac ? [] : [separator, { label: `About ${APP_NAME}`, click: () => commands.showAbout() } satisfies MenuItemConstructorOptions])
            ]
        }
    ];

    return Menu.buildFromTemplate(template);
}
