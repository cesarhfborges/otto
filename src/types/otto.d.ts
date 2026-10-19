import type { OttoApi } from '../../electron/shared/contract';

declare global {
    interface Window {
        /** Disponível apenas quando o app roda dentro do Electron (exposto pelo preload). */
        otto?: OttoApi;
    }
}

export {};
