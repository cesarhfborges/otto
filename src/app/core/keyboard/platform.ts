import { DOCUMENT, inject, InjectionToken } from '@angular/core';
import { OTTO_API } from '../bridge/otto-api.token';

/** `true` no macOS: `Mod` vira `Cmd` e os atalhos são exibidos com símbolos (`⌘⇧T`). */
export const IS_MAC = new InjectionToken<boolean>('IS_MAC', {
    providedIn: 'root',
    factory: () => /darwin|mac/i.test(inject(OTTO_API)?.platform ?? inject(DOCUMENT).defaultView?.navigator.platform ?? '')
});
