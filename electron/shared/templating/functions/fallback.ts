import { UnresolvedError } from '../errors';
import { arg, fn, type CatalogNode } from '../node';

type Thunk = () => Promise<unknown>;

/** Avalia `thunk`; se não resolver, devolve `undefined` (outros erros continuam). */
async function attempt(thunk: Thunk | undefined): Promise<unknown> {
    try {
        return await thunk?.();
    } catch (error) {
        if (error instanceof UnresolvedError) {
            return undefined;
        }

        throw error;
    }
}

export const FALLBACK_FUNCTIONS: CatalogNode[] = [
    fn('default', 'any', 'Fallback when the value is unresolved', [arg('value'), arg('fallback')], async (value: Thunk, fallback: Thunk) => (await attempt(value)) ?? fallback(), { lazy: true, example: "{{ otto.default($.tenant, 'acme') }}" }),
    fn('optional', 'any', 'Empty text when the value is unresolved', [arg('value')], async (value: Thunk) => (await attempt(value)) ?? '', { lazy: true }),
    fn(
        'coalesce',
        'any',
        'First resolved, non-empty value',
        [arg('values…')],
        async (...values: Thunk[]) => {
            for (const value of values) {
                const result = await attempt(value);

                if (result !== undefined && result !== null && result !== '') {
                    return result;
                }
            }

            throw new UnresolvedError('No value resolved in otto.coalesce');
        },
        { lazy: true }
    )
];
