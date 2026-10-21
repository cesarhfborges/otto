import type { VariableScope } from './ast';
import { CircularReferenceError, errorMessage, TemplateError, UnresolvedError } from './errors';
import { evaluate } from './evaluate';
import type { MessageSnapshot, ReadGuard } from './message';
import { parseExpression } from './parse';
import { createOtto, type OttoHost } from './runtime';
import type { VariableScopes } from './scopes';
import { toTemplateText } from './serialize';
import { hasTags, tokenize } from './tokenize';

/** Variáveis que apontam para outras são resolvidas até esta profundidade. */
const MAX_DEPTH = 5;

export interface RenderResult {
    text: string;
    /** Variáveis não definidas (sem repetição). */
    unresolved: string[];
    /** Demais problemas (sintaxe, comando inválido, requisição sem resposta…). */
    errors: string[];
}

export interface TemplateEngineOptions {
    scopes: VariableScopes;
    host: OttoHost;
    /** Requisição atual interpolada (para `otto.request`). */
    currentRequest?: () => Promise<MessageSnapshot>;
}

export interface TemplateEngine {
    /** Interpola o texto; tags que falham ficam como estão e o motivo vai para `unresolved`/`errors`. */
    render(text: string, guard?: ReadGuard): Promise<RenderResult>;
}

export function createTemplateEngine({ scopes, host, currentRequest }: TemplateEngineOptions): TemplateEngine {
    /** Interpola sem tolerar erros (valores de variáveis). */
    const strict = async (text: string, stack: readonly string[], guard: ReadGuard): Promise<string> => {
        let out = '';

        for (const segment of tokenize(text)) {
            out += segment.type === 'text' ? segment.value : toTemplateText(await evaluate(parseExpression(segment.inner), env(stack, guard)));
        }

        return out;
    };

    const env = (stack: readonly string[], guard: ReadGuard) => ({
        otto: createOtto(host, currentRequest, guard),
        variable: async (name: string, scope: VariableScope | null): Promise<string> => {
            const entry = scopes.lookup(name, scope);

            if (!entry) {
                throw new UnresolvedError(`Variable "${name}" is not defined`, name);
            }

            if (stack.includes(name)) {
                throw new CircularReferenceError(`Variables form a cycle: ${[...stack, name].join(' → ')}`);
            }

            if (stack.length >= MAX_DEPTH) {
                throw new TemplateError(`Variable "${name}" nests more than ${MAX_DEPTH} levels`);
            }

            return hasTags(entry.value) ? strict(entry.value, [...stack, name], {}) : entry.value;
        }
    });

    return {
        async render(text, guard = {}) {
            const unresolved = new Set<string>();
            const errors = new Set<string>();
            let out = '';

            for (const segment of tokenize(text)) {
                if (segment.type === 'text') {
                    out += segment.value;
                    continue;
                }

                try {
                    out += toTemplateText(await evaluate(parseExpression(segment.inner), env([], guard)));
                } catch (error) {
                    if (error instanceof UnresolvedError && error.variable) {
                        unresolved.add(error.variable);
                    } else {
                        errors.add(`${segment.raw.length > 60 ? `${segment.raw.slice(0, 57)}…` : segment.raw}: ${errorMessage(error)}`);
                    }

                    out += segment.raw;
                }
            }

            return { text: out, unresolved: [...unresolved], errors: [...errors] };
        }
    };
}
