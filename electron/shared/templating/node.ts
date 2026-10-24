/** Onde o membro vale: T = templates, Pre/Post = scripts (futuro). */
export type Where = 'T' | 'Pre' | 'Post';

/** Fonte de sugestões de um argumento (autocomplete). */
export type ArgSource = 'requests' | 'paths' | 'headers' | 'cookies' | 'params' | 'forms' | 'variables';

export interface ArgSpec {
    name: string;
    optional?: boolean;
    /** Valores fixos sugeridos (`'sha256'`, `'v7'`…). */
    values?: readonly string[];
    source?: ArgSource;
}

/** Entrada do catálogo do objeto `otto`: documentação, assinatura e (quando estática) implementação. */
export interface CatalogNode {
    name: string;
    kind: 'namespace' | 'object' | 'function' | 'property';
    description: string;
    returns: string;
    args?: readonly ArgSpec[];
    example?: string;
    /** Padrão: T, Pre e Post. */
    where?: readonly Where[];
    /** Membros do próprio nó (namespace, objeto ou função com sub-funções, como `base64.decode`). */
    members?: readonly CatalogNode[];
    /** Membros do valor devolvido pela função (`request(…)` → `.response`…). */
    result?: readonly CatalogNode[];
    /** Recebe os argumentos sem avaliar (funções `() => Promise`), para `default`/`optional`. */
    lazy?: boolean;
    /** Implementação de membros estáticos (os que dependem do envio vêm do `OttoHost`). */
    impl?: (...args: never[]) => unknown;
}

export const signature = (node: CatalogNode): string => (node.kind === 'function' ? `${node.name}(${(node.args ?? []).map((arg) => arg.name + (arg.optional ? '?' : '')).join(', ')})` : node.name);

/** O valor tem estrutura livre (`any`, `object`…): membros depois dele não são validados. */
export const isDynamic = (returns: string): boolean => ['any', 'object', 'array'].includes(returns);

type Impl = (...args: never[]) => unknown;

export const arg = (name: string, extra: Omit<ArgSpec, 'name'> = {}): ArgSpec => ({ name, ...extra });
export const opt = (name: string, extra: Omit<ArgSpec, 'name' | 'optional'> = {}): ArgSpec => ({ name, optional: true, ...extra });

export const fn = (name: string, returns: string, description: string, args: readonly ArgSpec[], impl?: Impl, extra: Partial<CatalogNode> = {}): CatalogNode => ({ name, kind: 'function', returns, description, args, ...(impl && { impl }), ...extra });

export const ns = (name: string, description: string, members: readonly CatalogNode[], extra: Partial<CatalogNode> = {}): CatalogNode => ({ name, kind: 'namespace', returns: 'namespace', description, members, ...extra });

export const prop = (name: string, returns: string, description: string, extra: Partial<CatalogNode> = {}): CatalogNode => ({ name, kind: 'property', returns, description, ...extra });

/** Converte argumentos para texto (o que veio do template pode ser número, objeto…). */
export const str = (value: unknown): string => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
