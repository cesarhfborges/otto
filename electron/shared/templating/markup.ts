import { TemplateError, UnresolvedError } from './errors';

// Tipos mínimos do DOM: o motor roda no renderer (onde `DOMParser` existe), mas compila sem `lib: dom`.
interface DomNode {
    textContent: string | null;
    getAttribute?(name: string): string | null;
}

interface DomDocument extends DomNode {
    getElementsByTagName(name: string): { length: number };
    querySelector(selector: string): DomNode | null;
    evaluate(expression: string, context: DomDocument, resolver: null, type: number, result: null): XPathOutcome;
}

interface XPathOutcome {
    resultType: number;
    numberValue: number;
    stringValue: string;
    booleanValue: boolean;
    iterateNext(): DomNode | null;
}

const XPATH = { ANY: 0, NUMBER: 1, STRING: 2, BOOLEAN: 3 } as const;

function parseDocument(text: string, type: 'application/xml' | 'text/html'): DomDocument {
    const Parser = (globalThis as unknown as { DOMParser?: new () => { parseFromString(text: string, type: string): DomDocument } }).DOMParser;

    if (!Parser) {
        throw new TemplateError('XML/HTML parsing is not available here');
    }

    const doc = new Parser().parseFromString(text, type);

    if (type === 'application/xml' && doc.getElementsByTagName('parsererror').length) {
        throw new TemplateError('Body is not valid XML');
    }

    return doc;
}

/** Primeiro resultado de uma XPath (`//auth/token/text()`, `//user/@id`, `count(//item)`). */
export function xpathFirst(text: string, expression: string): string | number | boolean {
    const doc = parseDocument(text, 'application/xml');
    let outcome: XPathOutcome;

    try {
        outcome = doc.evaluate(expression, doc, null, XPATH.ANY, null);
    } catch {
        throw new TemplateError(`Invalid XPath "${expression}"`);
    }

    switch (outcome.resultType) {
        case XPATH.NUMBER:
            return outcome.numberValue;
        case XPATH.STRING:
            return outcome.stringValue;
        case XPATH.BOOLEAN:
            return outcome.booleanValue;
    }

    const node = outcome.iterateNext();

    if (!node) {
        throw new UnresolvedError(`XPath "${expression}" not found`);
    }

    return node.textContent ?? '';
}

/** Primeiro elemento do seletor CSS; `::attr(nome)` lê um atributo, `::text` (padrão) o texto. */
export function cssFirst(text: string, query: string): string {
    const match = /^(.*?)(?:::(text|attr)(?:\(\s*([^)]+?)\s*\))?)?\s*$/.exec(query)!;
    const [, selector = '', mode = 'text', attribute] = match;

    if (mode === 'attr' && !attribute) {
        throw new TemplateError('Use ::attr(name) to read an attribute');
    }

    let element: DomNode | null;

    try {
        element = parseDocument(text, 'text/html').querySelector(selector.trim());
    } catch (error) {
        throw error instanceof TemplateError ? error : new TemplateError(`Invalid CSS selector "${selector.trim()}"`);
    }

    const value = !element ? null : mode === 'attr' ? (element.getAttribute?.(attribute!) ?? null) : (element.textContent ?? '').trim();

    if (value === null) {
        throw new UnresolvedError(`"${query}" not found`);
    }

    return value;
}

/** Trecho que casa com a expressão; `group`: índice ou nome do grupo (padrão: o trecho inteiro). */
export function regexMatch(text: string, pattern: string, group: number | string = 0): string {
    let regex: RegExp;

    try {
        regex = new RegExp(pattern);
    } catch {
        throw new TemplateError(`Invalid regular expression "${pattern}"`);
    }

    const match = regex.exec(text);
    const value = !match ? undefined : typeof group === 'number' || /^\d+$/.test(group) ? match[Number(group)] : match.groups?.[group];

    if (value === undefined) {
        throw new UnresolvedError(`/${pattern}/ did not match${group ? ` (group ${group})` : ''}`);
    }

    return value;
}
