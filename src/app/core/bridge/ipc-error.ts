/**
 * O Electron embrulha erros do main como
 * `Error invoking remote method 'canal': ValidationError: mensagem`.
 * Extrai só a mensagem útil para exibir ao usuário.
 */
export function ipcErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    return message.replace(/^Error invoking remote method '[^']+': /, '').replace(/^\w*Error: /, '');
}
