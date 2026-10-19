import type { HttpRequest, HttpResult } from '../../../shared/models';

/**
 * Executa requisições HTTP fora do renderer (sem CORS).
 *
 * Implementações podem ser decoradas (ex.: registro de histórico/métricas)
 * sem alterar o executor base.
 */
export interface IHttpExecutor {
    execute(request: HttpRequest): Promise<HttpResult>;
    /** Cancela uma requisição em andamento. Retorna `false` se ela não existir mais. */
    cancel(requestId: string): boolean;
}
