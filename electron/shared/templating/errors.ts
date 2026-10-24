/** Erro de template (sintaxe, comando desconhecido, argumento inválido…). */
export class TemplateError extends Error {
    override readonly name: string = 'TemplateError';
}

/** Valor que não existe (variável, caminho, header, resposta…): `otto.default` / `otto.optional` aceitam. */
export class UnresolvedError extends TemplateError {
    override readonly name = 'UnresolvedError';

    constructor(
        message: string,
        /** Nome da variável não definida, quando for o caso. */
        readonly variable?: string
    ) {
        super(message);
    }
}

/** Variáveis/requisições que dependem umas das outras em ciclo, ou campo que lê a si mesmo. */
export class CircularReferenceError extends TemplateError {
    override readonly name = 'CircularReferenceError';
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
