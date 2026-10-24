import { BrowserWindow, session } from 'electron';
import type { OAuth2Authorizer } from '../services/http/auth/oauth2';

/** Sessão em memória: logins valem até fechar o app e não se misturam com a janela principal. */
const PARTITION = 'otto-oauth2';

/** Mesma origem e caminho da URL de callback (query/fragmento trazem o resultado). */
function isCallback(url: string, callbackUrl: string): boolean {
    try {
        const target = new URL(url);
        const callback = new URL(callbackUrl);

        return target.protocol === callback.protocol && target.host === callback.host && target.pathname.replace(/\/$/, '') === callback.pathname.replace(/\/$/, '');
    } catch {
        return false;
    }
}

/**
 * Janela de login do OAuth 2.0: abre a URL de autorização e resolve com a URL de
 * callback assim que o provedor redireciona para ela (o callback em si não é carregado).
 */
export function createOAuth2Authorizer(parent: () => BrowserWindow | null): OAuth2Authorizer {
    return (authorizationUrl, callbackUrl, signal) =>
        new Promise<string>((resolve, reject) => {
            const owner = parent();
            const oauthSession = session.fromPartition(PARTITION);
            const win = new BrowserWindow({
                width: 520,
                height: 720,
                title: 'Authorize',
                autoHideMenuBar: true,
                ...(owner && { parent: owner }),
                webPreferences: { session: oauthSession, contextIsolation: true, nodeIntegration: false, sandbox: true }
            });
            let settled = false;

            const finish = (error: Error | null, url?: string): void => {
                if (settled) {
                    return;
                }

                settled = true;
                oauthSession.webRequest.onBeforeRequest(null);
                signal.removeEventListener('abort', onAbort);

                if (!win.isDestroyed()) {
                    win.close();
                }

                if (error) {
                    reject(error);
                } else {
                    resolve(url!);
                }
            };
            const onAbort = (): void => finish(signal.reason instanceof Error ? signal.reason : new Error('Authorization cancelled'));
            const intercept = (event: { preventDefault: () => void }, url: string): void => {
                if (isCallback(url, callbackUrl)) {
                    event.preventDefault();
                    finish(null, url);
                }
            };

            // Redirecionamentos HTTP(S) para o callback (normalmente um endereço que nem existe).
            oauthSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
                if (isCallback(details.url, callbackUrl)) {
                    callback({ cancel: true });
                    finish(null, details.url);
                } else {
                    callback({});
                }
            });
            // Esquemas próprios (`myapp://callback`) não passam pelo `webRequest`.
            win.webContents.on('will-redirect', intercept);
            win.webContents.on('will-navigate', intercept);
            win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            win.on('closed', () => finish(new Error('OAuth 2.0: the authorization window was closed before finishing')));
            signal.addEventListener('abort', onAbort, { once: true });

            win.loadURL(authorizationUrl).catch((error: Error) => {
                // Cancelar a navegação para o callback também rejeita o `loadURL`.
                if (!settled && !/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(error.message)) {
                    finish(new Error(`OAuth 2.0: could not open the authorization page (${error.message})`));
                }
            });
        });
}
