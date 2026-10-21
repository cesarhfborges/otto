import { type Completion, type CompletionContext, type CompletionResult, type CompletionSource, snippetCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { Facet } from '@codemirror/state';
import { completionContext, REQUEST_REF_OPTIONS, type Where } from '@shared/templating';
import type { ScriptPhase } from '@/app/core/scripting/script-runner';
import { argumentOptions, insert, memberOptions, quote, SECTIONS, type TemplateCompletionData } from '../template-editor/template-completions';

export interface ScriptCompletionData {
    phase: ScriptPhase;
    data: TemplateCompletionData | null;
}

export const scriptCompletionData = Facet.define<ScriptCompletionData, ScriptCompletionData>({
    combine: (values) => values.at(-1) ?? { phase: 'preRequest', data: null }
});

const WHERE: Record<ScriptPhase, Where> = { preRequest: 'Pre', postResponse: 'Post' };

const inComment = (context: CompletionContext): boolean => /Comment/.test(syntaxTree(context.state).resolveInner(context.pos, -1).name);

/**
 * Comandos `otto.*` do catálogo (os mesmos dos templates, filtrados pela fase), com
 * sugestões de argumentos: requisições, JSONPaths e headers da última resposta, variáveis…
 */
const ottoCommands: CompletionSource = (context) => {
    const { phase, data } = context.state.facet(scriptCompletionData);

    if (!data || inComment(context)) {
        return null;
    }

    const line = context.state.doc.lineAt(context.pos);
    const analysis = completionContext(line.text.slice(0, context.pos - line.from));
    const from = line.from + ('from' in analysis ? analysis.from : 0);
    let options: Completion[] = [];

    switch (analysis.type) {
        case 'root':
            options = analysis.prefix || context.explicit ? [{ label: 'otto', detail: 'namespace', info: 'Otto commands and request data', type: 'namespace', section: SECTIONS['commands'], apply: insert('otto.', 0, true), boost: 10 }] : [];
            break;
        case 'member':
            options = memberOptions(analysis.members, WHERE[phase]);
            break;
        case 'argument':
            if (analysis.arg?.source === 'variables') {
                options = data.variables().map((variable) => ({
                    label: variable.name,
                    detail: `${variable.label} · ${variable.secret ? '••••' : variable.value || '(empty)'}`,
                    type: 'variable',
                    section: SECTIONS['variables'],
                    apply: analysis.quoted ? variable.name : quote(variable.name)
                }));
            } else if (analysis.arg?.source || analysis.arg?.values) {
                options = argumentOptions(analysis.arg, analysis.target, analysis.quoted, data);
            }
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

    return options.length ? { from, options, validFor: /^[\w$.\-[\]'@*?()=!<> ]*$/ } : null;
};

const SNIPPETS: Record<ScriptPhase, Completion[]> = {
    preRequest: [
        snippetCompletion("otto.request.setHeader('${Header}', ${value});", { label: 'setheader', detail: 'Add or replace a header', type: 'text' }),
        snippetCompletion("otto.environment.set('${name}', ${value});", { label: 'envset', detail: 'Set an environment variable', type: 'text' }),
        snippetCompletion("const ${login} = await otto.request('${}', { send: 'expired', maxAge: 600 }).response;", { label: 'fromrequest', detail: 'Response of another request', type: 'text' })
    ],
    postResponse: [
        snippetCompletion("otto.environment.set('${name}', otto.response.json('${$.access_token}'));", { label: 'envset', detail: 'Save a response value in the environment', type: 'text' }),
        snippetCompletion('if (otto.response.status === ${200}) {\n\t${}\n}', { label: 'ifstatus', detail: 'Check the status code', type: 'text' })
    ]
};

const snippetSource: CompletionSource = (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w$]+/);

    if (inComment(context) || (!word && !context.explicit) || context.matchBefore(/\.[\w$]*$/)) {
        return null;
    }

    return { from: word?.from ?? context.pos, options: SNIPPETS[context.state.facet(scriptCompletionData).phase], validFor: /^[\w$]*$/ };
};

export const scriptCompletionSources: readonly CompletionSource[] = [ottoCommands, snippetSource];
