import type { KeyValue } from '../models/common';

const decode = (text: string): string => {
    try {
        return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch {
        return text;
    }
};

/**
 * Query montada pelos params habilitados, como fica após a URL no envio (`?a=1&b=2`, ou
 * `&a=1` se a URL já tem `?`). Só para exibição: valores sem codificar, `{{variáveis}}` legíveis.
 */
export function querySuffix(url: string, params: readonly KeyValue[]): string {
    const pairs = params.filter((param) => param.enabled && param.key.trim()).map(({ key, value }) => `${key.trim()}=${value}`);

    if (!pairs.length) {
        return '';
    }

    const base = url.split('#')[0] ?? '';
    const separator = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&';

    return `${separator}${pairs.join('&')}`;
}

/** Separa a query da URL em params habilitados (a URL volta sem ela, mantendo o fragmento). */
export function extractQuery(url: string): { url: string; params: KeyValue[] } {
    const hashStart = url.indexOf('#');
    const [beforeHash, hash] = hashStart >= 0 ? [url.slice(0, hashStart), url.slice(hashStart)] : [url, ''];
    const queryStart = beforeHash.indexOf('?');

    if (queryStart < 0) {
        return { url, params: [] };
    }

    const params = beforeHash
        .slice(queryStart + 1)
        .split('&')
        .filter(Boolean)
        .map((pair) => {
            const [key = '', ...rest] = pair.split('=');

            return { key: decode(key), value: decode(rest.join('=')), enabled: true };
        });

    return { url: `${beforeHash.slice(0, queryStart)}${hash}`, params };
}
