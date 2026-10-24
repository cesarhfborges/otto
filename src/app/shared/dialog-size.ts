/**
 * Diálogos com editores de código (gerar código, histórico): tamanho fixo com limites,
 * sem redimensionar, sempre dentro da janela. O conteúdo ocupa a altura disponível
 * e só os editores rolam (`contentStyleClass` = `LARGE_DIALOG_CONTENT`).
 */
export const LARGE_DIALOG_STYLE = {
    width: '56rem',
    minWidth: 'min(24rem, calc(100vw - 2rem))',
    maxWidth: 'calc(100vw - 2rem)',
    height: 'min(44rem, calc(100vh - 4rem))',
    minHeight: 'min(22rem, calc(100vh - 2rem))'
};

export const LARGE_DIALOG_CONTENT = 'flex min-h-0 flex-1 flex-col !overflow-hidden';
