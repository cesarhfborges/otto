import { DOCUMENT, inject, InjectionToken } from '@angular/core';
import type { OttoApi } from '@shared/api';

/** API exposta pelo preload, ou `null` quando o app roda no navegador (`npm run web:serve`). */
export const OTTO_API = new InjectionToken<OttoApi | null>('OTTO_API', {
    providedIn: 'root',
    factory: () => inject(DOCUMENT).defaultView?.otto ?? null
});

export class BridgeUnavailableError extends Error {
    constructor() {
        super('Otto desktop bridge is not available (running outside Electron?)');
        this.name = 'BridgeUnavailableError';
    }
}

/** Retorna a API do Electron ou lança `BridgeUnavailableError`. */
export function requireOttoApi(api: OttoApi | null): OttoApi {
    if (!api) {
        throw new BridgeUnavailableError();
    }

    return api;
}
