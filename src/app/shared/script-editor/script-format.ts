import type { Plugin } from 'prettier';

/**
 * Formata o script com o Prettier (carregado só no primeiro uso). Mesmo estilo do projeto,
 * com linhas mais curtas para caber no painel. Lança o erro de sintaxe do Prettier.
 */
export async function formatScript(code: string): Promise<string> {
    const [prettier, babel, estree] = await Promise.all([import('prettier/standalone'), import('prettier/plugins/babel'), import('prettier/plugins/estree')]);

    return prettier.format(code, {
        parser: 'babel',
        // O `.d.ts` do plugin estree não declara a forma de plugin.
        plugins: [babel, estree as unknown as Plugin],
        tabWidth: 4,
        printWidth: 100,
        singleQuote: true,
        semi: true,
        trailingComma: 'none'
    });
}
