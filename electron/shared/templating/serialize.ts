/** Objeto com conversão própria para texto (`Cookies`, leitor de mensagem…). */
interface TemplateStringable {
    toTemplateString(): string;
}

const isStringable = (value: unknown): value is TemplateStringable => typeof value === 'object' && value !== null && typeof (value as Partial<TemplateStringable>).toTemplateString === 'function';

/** Resultado de uma tag → texto inserido no campo (§3.4 do plano). */
export function toTemplateText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (isStringable(value)) {
        return value.toTemplateString();
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}
