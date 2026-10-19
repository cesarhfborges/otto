import type { OttoApi } from '@shared/api';

declare global {
    interface Window {
        /** Disponível apenas quando o app roda dentro do Electron (exposto pelo preload). */
        otto?: OttoApi;
    }
}

export {};
