import type { SendPolicy } from './runtime';

/** O que ler da resposta da requisição referenciada. */
export type ResponseRefSource = 'json' | 'header' | 'cookie' | 'status' | 'text';

/**
 * Referência à resposta de outra requisição, como o construtor visual a edita:
 * `otto.request('rq_…', { send, maxAge, expect }).response.json('$.token')`.
 */
export interface ResponseRef {
    /** `id` estável (`rq_…`) ou caminho da requisição. */
    request: string;
    source: ResponseRefSource;
    /** JSONPath, nome do header ou do cookie (vazio para `status`/`text`; `json` vazio = corpo inteiro). */
    argument: string;
    send: SendPolicy;
    /** Segundos; só com `send: 'expired'`. */
    maxAge: number | null;
    /** Status esperado (`200`, `2xx`); vazio = qualquer. */
    expect: string;
}

const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const unquote = (value: string): string => value.replace(/\\(.)/g, '$1');

/** Expressão (sem `{{ }}`) para a referência. `send: 'empty'` é o padrão e não é escrito. */
export function formatResponseRef(ref: ResponseRef): string {
    const options = [
        ...(ref.send !== 'empty' ? [`send: ${quote(ref.send)}`] : []),
        ...(ref.send === 'expired' && ref.maxAge !== null ? [`maxAge: ${ref.maxAge}`] : []),
        ...(ref.expect.trim() ? [/^\d{3}$/.test(ref.expect.trim()) ? `expect: ${ref.expect.trim()}` : `expect: ${quote(ref.expect.trim())}`] : [])
    ];
    const head = `otto.request(${quote(ref.request)}${options.length ? `, { ${options.join(', ')} }` : ''}).response`;

    switch (ref.source) {
        case 'json':
            return ref.argument.trim() ? `${head}.json(${quote(ref.argument.trim())})` : `${head}.json()`;
        case 'header':
            return `${head}.header(${quote(ref.argument.trim())})`;
        case 'cookie':
            return `${head}.cookie(${quote(ref.argument.trim())})`;
        case 'status':
            return `${head}.status`;
        case 'text':
            return `${head}.body.text()`;
    }
}

const STRING = String.raw`'((?:[^'\\]|\\.)*)'`;
const REF_PATTERN = new RegExp(String.raw`^\s*otto\.request\(\s*${STRING}\s*(?:,\s*\{([^}]*)\})?\s*\)\.response\.(.+?)\s*$`);
const ACCESSORS: Array<[RegExp, ResponseRefSource]> = [
    [new RegExp(String.raw`^(?:body\.)?json\(\s*(?:${STRING})?\s*\)$`), 'json'],
    [new RegExp(String.raw`^header\(\s*${STRING}\s*\)$`), 'header'],
    [new RegExp(String.raw`^cookie\(\s*${STRING}\s*\)$`), 'cookie'],
    [/^(?:status|code)$/, 'status'],
    [/^body\.text\(\s*\)$/, 'text']
];

/** Lê uma tag gerada pelo construtor (ou escrita no mesmo formato); `null` se for outra coisa. */
export function parseResponseRef(expression: string): ResponseRef | null {
    const match = REF_PATTERN.exec(expression);

    if (!match) {
        return null;
    }

    const [, request, rawOptions = '', accessor] = match;
    const option = (key: string): string | null => {
        const found = new RegExp(String.raw`\b${key}\s*:\s*(?:${STRING}|(\d+))`).exec(rawOptions);

        return found ? (found[1] !== undefined ? unquote(found[1]) : (found[2] ?? null)) : null;
    };
    const send = option('send');

    for (const [pattern, source] of ACCESSORS) {
        const accessed = pattern.exec(accessor!);

        if (accessed) {
            const maxAge = option('maxAge');

            return {
                request: unquote(request!),
                source,
                argument: accessed[1] !== undefined ? unquote(accessed[1]) : '',
                send: send === 'never' || send === 'expired' || send === 'always' ? send : 'empty',
                maxAge: maxAge === null ? null : Number(maxAge),
                expect: option('expect') ?? ''
            };
        }
    }

    return null;
}
