import { app } from 'electron';
import * as path from 'node:path';

export const APP_ID = 'dev.otto.app';
export const APP_NAME = 'Otto';
export const REPOSITORY_URL = 'https://github.com/cesarhfborges/otto';

/** Modo desenvolvimento: carrega o `ng serve` em vez do build estático. */
export const isDev = !app.isPackaged && process.env['NODE_ENV'] === 'development';

export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';

export const rendererUrl = process.env['OTTO_RENDERER_URL'] ?? 'http://localhost:4200';

export const rendererIndexPath = (): string => path.join(app.getAppPath(), 'dist', 'otto', 'browser', 'index.html');

export const assetPath = (...segments: string[]): string => path.join(app.getAppPath(), 'assets', ...segments);

/** Pasta base padrão dos workspaces: `Documentos/otto` do usuário. */
export const defaultBaseDirectory = (): string => path.join(app.getPath('documents'), 'otto');
