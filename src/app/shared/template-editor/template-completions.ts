import { startCompletion, type Completion, type CompletionContext as CmContext, type CompletionResult, type CompletionSection } from '@codemirror/autocomplete';
import { Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { availableIn, completionContext, REQUEST_REF_OPTIONS, signature, type ArgSpec, type CatalogNode, type MessageTarget, type VariableEntry } from '@shared/templating';
import { tagAt } from './template-extensions';

export interface MessageSuggestions {
    /** Ex.: `Login · 200 · received 4 min ago`. */
    title: string;
    paths: Array<{ path: string; value: unknown }>;
    headers: string[];
    cookies: string[];
    params: string[];
    forms: string[];
}

export interface RequestSuggestion {
    id: string | null;
    name: string;
    path: string;
    folder: string;
    method: string;
}

/** Dados do autocomplete, fornecidos pelo componente (escopos, requisições, última resposta). */
export interface TemplateCompletionData {
    variables(): VariableEntry[];
    requests(): RequestSuggestion[];
    message(target: MessageTarget): MessageSuggestions | null;
}

export const completionData = Facet.define<TemplateCompletionData, TemplateCompletionData | null>({ combine: (values) => values.at(-1) ?? null });

const SECTIONS: Record<string, CompletionSection> = {
    variables: { name: 'Variables', rank: 0 },
    commands: { name: 'Commands', rank: 1 },
    shortcuts: { name: 'Shortcuts', rank: 2 },
    requests: { name: 'Requests', rank: 0 },
    values: { name: 'Values', rank: 0 }
};

const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const preview = (value: unknown): string => {
    const text = typeof value === 'string' ? JSON.stringify(value) : Array.isArray(value) ? '[…]' : value && typeof value === 'object' ? '{…}' : String(value);

    return text.length > 40 ? `${text.slice(0, 39)}…` : text;
};

/** Aplica o texto e reabre a lista (namespaces, `(`…). `cursorBack`: recua o cursor (dentro de `()`/`('')`). */
const insert =
    (text: string, cursorBack = 0, reopen = false) =>
    (view: EditorView, _completion: Completion, from: number, to: number): void => {
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length - cursorBack }, userEvent: 'input.complete' });

        if (reopen) {
            startCompletion(view);
        }
    };

function variableOptions(variables: VariableEntry[], withPrefix: boolean): Completion[] {
    return variables.map((variable) => ({
        label: withPrefix ? `$.${variable.name}` : variable.name,
        detail: `${variable.label} · ${variable.secret ? '••••' : variable.value || '(empty)'}`,
        type: variable.secret ? 'secret' : 'variable',
        section: SECTIONS['variables'],
        boost: variable.shadowed ? -10 : 0,
        ...(variable.shadowed && { info: `Overridden by a more specific scope`, detail: `${variable.label} · overridden` }),
        apply: withPrefix ? `$.${variable.name}` : variable.name
    }));
}

function memberOptions(members: readonly CatalogNode[]): Completion[] {
    return members
        .filter((member) => availableIn(member, 'T'))
        .map((member) => {
            const callable = member.kind === 'function';
            const firstIsText = callable && !!member.args?.[0] && !member.args[0].name.endsWith('…') && member.args[0].name !== 'value' && member.args[0].name !== 'options';
            const nested = member.kind === 'namespace' || member.kind === 'object' || (!!member.result && callable);

            return {
                label: callable ? signature(member) : member.name,
                detail: member.returns,
                info: member.example ? `${member.description}\nExample: ${member.example}` : member.description,
                type: callable ? 'function' : member.kind === 'property' ? 'property' : 'namespace',
                section: SECTIONS['commands'],
                apply: callable ? insert(`${member.name}(${firstIsText ? "''" : ''})`, firstIsText ? 2 : member.args?.length ? 1 : 0, true) : insert(`${member.name}${nested ? '.' : ''}`, 0, nested)
            };
        });
}

/**
 * Aplica um valor de argumento e leva o cursor para depois da `'` e do `)` que já o fecham
 * (`otto.request('id')|`), para seguir com `.` direto.
 */
const argument =
    (text: string) =>
    (view: EditorView, _completion: Completion, from: number, to: number): void => {
        const after = view.state.sliceDoc(to, to + 2);
        const skip = after.startsWith("')") ? 2 : after.startsWith("'") || after.startsWith(')') ? 1 : 0;

        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length + skip }, userEvent: 'input.complete' });
    };

function argumentOptions(spec: ArgSpec | undefined, target: MessageTarget | null, quoted: boolean, data: TemplateCompletionData): Completion[] {
    const value = (label: string, detail?: string, apply = label): Completion => ({ label, ...(detail && { detail }), type: 'value', section: SECTIONS['values'], apply: argument(quoted ? apply : quote(apply)) });

    if (spec?.values) {
        return spec.values.map((item) => value(item));
    }

    switch (spec?.source) {
        case 'requests':
            return data.requests().map((request) => ({ ...value(request.name, `${request.method} · ${request.folder || '/'}`, request.id ?? request.path.replace(/\.[^./]+$/, '')), section: SECTIONS['requests'], type: 'request' }));
        case 'paths':
        case 'headers':
        case 'cookies':
        case 'params':
        case 'forms': {
            const message = target && data.message(target);

            if (!message) {
                return [{ label: target?.ref ? 'No response yet — send the request to get suggestions' : 'No suggestions', type: 'text', apply: () => undefined }];
            }

            return spec.source === 'paths' ? message.paths.map((item) => value(item.path, preview(item.value))) : message[spec.source].map((name) => value(name, message.title));
        }
    }

    return quoted ? [] : variableOptions(data.variables(), true);
}

/** Envolve o texto em `{{ … }}` (fora de tag); `cursorBack` conta a partir do fim do texto interno. */
const wrapped = (text: string, cursorBack = 0, reopen = false, spaced = true) => (spaced ? insert(`{{ ${text} }}`, cursorBack + 3, reopen) : insert(`{{${text}}}`, cursorBack, reopen));

/** Ctrl+Space fora de uma tag: sugestões que já inserem a tag completa. */
function outsideTagCompletions(context: CmContext, data: TemplateCompletionData): CompletionResult | null {
    const word = context.matchBefore(/[\w$.]*/);

    if (!context.explicit && !word?.text) {
        return null;
    }

    const options: Completion[] = [
        ...variableOptions(data.variables(), true).map((option) => ({ ...option, apply: wrapped(option.label, 0, false, false) })),
        { label: 'otto', detail: 'namespace', info: 'Otto commands and request data', type: 'namespace', section: SECTIONS['commands'], apply: wrapped('otto.', 0, true) },
        { label: 'Response from another request…', type: 'request', section: SECTIONS['shortcuts'], apply: wrapped("otto.request('')", 2, true) }
    ];

    return { from: word?.from ?? context.pos, options, validFor: /^[\w$.]*$/ };
}

/** Fonte de sugestões do CodeMirror: dentro de `{{ … }}` ou, com Ctrl+Space, fora dela. */
export function templateCompletions(context: CmContext): CompletionResult | null {
    const data = context.state.facet(completionData);
    const tag = tagAt(context.state, context.pos);

    if (!data) {
        return null;
    }

    if (!tag || context.pos < tag.innerStart || context.pos > tag.end - 2) {
        return context.explicit ? outsideTagCompletions(context, data) : null;
    }

    const analysis = completionContext(context.state.sliceDoc(tag.innerStart, context.pos));
    let options: Completion[] = [];

    switch (analysis.type) {
        case 'root':
            options = [
                ...variableOptions(data.variables(), true),
                { label: 'otto', detail: 'namespace', info: 'Otto commands and request data', type: 'namespace', section: SECTIONS['commands'], apply: insert('otto.', 0, true) },
                ...(analysis.prefix ? [] : [{ label: 'Response from another request…', type: 'request', section: SECTIONS['shortcuts'], apply: insert("otto.request('')", 2, true) }])
            ];
            break;
        case 'variable':
            options = variableOptions(data.variables(), false);
            break;
        case 'member':
            options = memberOptions(analysis.members);
            break;
        case 'argument':
            options = argumentOptions(analysis.arg, analysis.target, analysis.quoted, data);
            break;
        case 'option':
            options =
                analysis.key === null
                    ? Object.entries({ send: "send: ''", maxAge: 'maxAge: ', expect: "expect: ''" }).map(([key, text]) => ({ label: key, type: 'property', section: SECTIONS['values'], apply: insert(text, text.endsWith("''") ? 1 : 0, true) }))
                    : analysis.key === 'send'
                      ? REQUEST_REF_OPTIONS.send.map((item) => ({ label: item, type: 'value', section: SECTIONS['values'], apply: analysis.quoted ? item : quote(item) }))
                      : [];
            break;
        default:
            return null;
    }

    return options.length ? { from: tag.innerStart + analysis.from, options, validFor: /^[\w$.\-[\]'@*?()=!<> ]*$/ } : null;
}
