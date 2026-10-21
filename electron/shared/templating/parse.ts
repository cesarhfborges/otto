import type { Access, Expr, VariableScope } from './ast';
import { TemplateError } from './errors';

type Token = { type: 'ident' | 'string' | 'number' | 'punct'; value: string; pos: number };

const IDENT = /[A-Za-z_][\w-]*/y;
const NUMBER = /-?\d+(\.\d+)?/y;
const PUNCT = '.[](),{}:$';
const LEGACY_NAME = /^[^$'"()[\]{}]+$/;

function lex(source: string): Token[] {
    const tokens: Token[] = [];

    for (let i = 0; i < source.length; ) {
        const char = source[i]!;

        if (/\s/.test(char)) {
            i++;
            continue;
        }

        if (char === "'" || char === '"') {
            let value = '';
            let j = i + 1;

            for (; j < source.length && source[j] !== char; j++) {
                value += source[j] === '\\' ? (source[++j] ?? '') : source[j];
            }

            if (j >= source.length) {
                throw new TemplateError(`Unterminated string at ${i + 1}`);
            }

            tokens.push({ type: 'string', value, pos: i });
            i = j + 1;
            continue;
        }

        let matched = false;

        for (const [type, pattern] of [
            ['number', NUMBER],
            ['ident', IDENT]
        ] as const) {
            pattern.lastIndex = i;
            const match = pattern.exec(source);

            // `1abc` não é número: cai no identificador (que também falha) e vira erro.
            if (match && (type === 'ident' || !/[A-Za-z_]/.test(source[i + match[0].length] ?? ''))) {
                tokens.push({ type, value: match[0], pos: i });
                i += match[0].length;
                matched = true;
                break;
            }
        }

        if (matched) {
            continue;
        }

        if (!PUNCT.includes(char)) {
            throw new TemplateError(`Unexpected "${char}" at ${i + 1}`);
        }

        tokens.push({ type: 'punct', value: char, pos: i });
        i++;
    }

    return tokens;
}

class Parser {
    private index = 0;

    constructor(private readonly tokens: Token[]) {}

    parse(): Expr {
        const expr = this.expr();

        if (this.peek()) {
            throw new TemplateError(`Unexpected "${this.peek()!.value}" at ${this.peek()!.pos + 1}`);
        }

        return expr;
    }

    private peek(): Token | undefined {
        return this.tokens[this.index];
    }

    private next(): Token {
        const token = this.tokens[this.index++];

        if (!token) {
            throw new TemplateError('Unexpected end of expression');
        }

        return token;
    }

    private is(value: string): boolean {
        return this.peek()?.type === 'punct' && this.peek()!.value === value;
    }

    private expect(value: string): void {
        const token = this.next();

        if (token.type !== 'punct' || token.value !== value) {
            throw new TemplateError(`Expected "${value}" at ${token.pos + 1}`);
        }
    }

    private ident(): string {
        const token = this.next();

        if (token.type !== 'ident') {
            throw new TemplateError(`Expected a name at ${token.pos + 1}`);
        }

        return token.value;
    }

    private expr(): Expr {
        const token = this.peek();

        if (!token) {
            throw new TemplateError('Empty expression');
        }

        if (token.type === 'string' || token.type === 'number') {
            this.index++;

            return { kind: 'literal', value: token.type === 'number' ? Number(token.value) : token.value };
        }

        if (token.type === 'ident') {
            this.index++;

            switch (token.value) {
                case 'true':
                case 'false':
                    return { kind: 'literal', value: token.value === 'true' };
                case 'null':
                    return { kind: 'literal', value: null };
                case 'otto':
                    return { kind: 'otto', access: this.accessChain() };
            }

            throw new TemplateError(`Unknown name "${token.value}" at ${token.pos + 1}: use $.${token.value} for variables or otto.… for commands`);
        }

        if (this.is('$')) {
            return this.variable();
        }

        if (this.is('{')) {
            return this.object();
        }

        if (this.is('[')) {
            this.index++;
            const items = this.is(']') ? [] : this.list(']');

            this.expect(']');

            return { kind: 'array', items };
        }

        throw new TemplateError(`Unexpected "${token.value}" at ${token.pos + 1}`);
    }

    private variable(): Expr {
        this.expect('$');
        let scope: VariableScope | null = null;

        // `$env.x` / `$collection.x`: o identificador vem colado ao `$`.
        const glued = this.peek();

        if (glued?.type === 'ident' && glued.pos === this.tokens[this.index - 1]!.pos + 1) {
            if (glued.value !== 'env' && glued.value !== 'collection') {
                throw new TemplateError(`Unknown variable scope "$${glued.value}": use $, $env or $collection`);
            }

            scope = glued.value;
            this.index++;
        }

        let name: string;

        if (this.is('.')) {
            this.index++;
            name = this.ident();
        } else {
            this.expect('[');
            const token = this.next();

            if (token.type !== 'string') {
                throw new TemplateError(`Expected a quoted variable name at ${token.pos + 1}`);
            }

            name = token.value;
            this.expect(']');
        }

        return { kind: 'var', scope, name, access: this.accessChain() };
    }

    private object(): Expr {
        this.expect('{');
        const entries: Array<[string, Expr]> = [];

        while (!this.is('}')) {
            const key = this.next();

            if (key.type !== 'ident' && key.type !== 'string') {
                throw new TemplateError(`Expected a property name at ${key.pos + 1}`);
            }

            this.expect(':');
            entries.push([key.value, this.expr()]);

            if (!this.is('}')) {
                this.expect(',');
            }
        }

        this.expect('}');

        return { kind: 'object', entries };
    }

    private list(close: string): Expr[] {
        const items = [this.expr()];

        while (this.is(',')) {
            this.index++;

            if (this.is(close)) {
                break;
            }

            items.push(this.expr());
        }

        return items;
    }

    private accessChain(): Access[] {
        const chain: Access[] = [];

        for (;;) {
            if (this.is('.')) {
                this.index++;
                chain.push({ kind: 'member', name: this.ident() });
            } else if (this.is('[')) {
                this.index++;
                chain.push({ kind: 'index', key: this.expr() });
                this.expect(']');
            } else if (this.is('(')) {
                this.index++;
                const args = this.is(')') ? [] : this.list(')');

                this.expect(')');
                chain.push({ kind: 'call', args });
            } else {
                return chain;
            }
        }
    }
}

/** Conteúdo de uma tag (`{{ … }}` sem as chaves) → AST. Lança `TemplateError` com a posição. */
export function parseExpression(inner: string): Expr {
    const trimmed = inner.trim();

    // Forma antiga: `{{baseUrl}}` / `{{ nome com espaço }}`.
    if (LEGACY_NAME.test(trimmed) && trimmed !== 'otto' && !trimmed.startsWith('otto.') && !/^(true|false|null|-?\d+(\.\d+)?)$/.test(trimmed)) {
        return { kind: 'legacy', name: trimmed };
    }

    return new Parser(lex(inner)).parse();
}

/** Igual a `parseExpression`, mas devolve o erro em vez de lançar. */
export function tryParse(inner: string): { expr: Expr; error: null } | { expr: null; error: string } {
    try {
        return { expr: parseExpression(inner), error: null };
    } catch (error) {
        return { expr: null, error: error instanceof Error ? error.message : String(error) };
    }
}
