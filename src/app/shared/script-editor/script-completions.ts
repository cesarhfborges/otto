import { type Completion, type CompletionContext, type CompletionResult, type CompletionSource, snippetCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { Facet } from '@codemirror/state';
import { completionContext, REQUEST_REF_OPTIONS, type Where } from '@shared/templating';
import type { ScriptPhase } from '@/app/core/scripting/script-runner';
import { argumentOptions, insert, memberOptions, quote, SECTIONS, type TemplateCompletionData } from '../template-editor/template-completions';

export interface ScriptCompletionData {
    phase: ScriptPhase;
    data: TemplateCompletionData | null;
    /** Nomes dos cookies guardados na coleção (`otto.cookies.get('…')`). */
    cookies?: () => readonly string[];
}

export const scriptCompletionData = Facet.define<ScriptCompletionData, ScriptCompletionData>({
    combine: (values) => values.at(-1) ?? { phase: 'preRequest', data: null }
});

const WHERE: Record<ScriptPhase, Where> = { preRequest: 'Pre', postResponse: 'Post' };

const inComment = (context: CompletionContext): boolean => /Comment/.test(syntaxTree(context.state).resolveInner(context.pos, -1).name);

/** O que costuma ser usado em cada fase sobe na lista (membro → boost). */
const BOOSTS: Record<ScriptPhase, Record<string, number>> = {
    preRequest: { request: 6, environment: 4, variables: 3, setHeader: 5, setParam: 4, setBody: 4, setUrl: 3, get: 2, set: 2 },
    postResponse: { response: 6, environment: 4, json: 5, status: 5, header: 4, set: 3, get: 2 }
};

const boosted = (options: Completion[], phase: ScriptPhase): Completion[] =>
    options.map((option) => {
        const boost = BOOSTS[phase][option.label.replace(/\(.*$/, '')];

        return boost ? { ...option, boost: (option.boost ?? 0) + boost } : option;
    });

const ALIAS = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(otto(?:\s*\.\s*[\w$]+|\((?:[^()\n]|\([^()\n]*\))*\))+)\s*;?[ \t]*$/gm;

/**
 * Variáveis do script que guardam um valor do `otto` (`const r = await otto.request('login').response`)
 * viram a expressão original, para `r.` sugerir o mesmo que `otto.request('login').response.`.
 * Devolve o texto expandido e quanto cada posição mudou.
 */
function expandAliases(doc: string, before: string): { text: string; shift: (pos: number) => number } {
    const aliases = new Map<string, string>();

    for (const match of doc.matchAll(ALIAS)) {
        aliases.set(match[1]!, match[2]!.replace(/\s*\.\s*/g, '.'));
    }

    if (!aliases.size) {
        return { text: before, shift: (pos) => pos };
    }

    const edits: Array<{ at: number; delta: number }> = [];
    const text = before.replace(/(?<![\w$.])([A-Za-z_$][\w$]*)(?=\s*\.)/g, (name: string, _group: string, at: number) => {
        const expression = aliases.get(name);

        if (!expression) {
            return name;
        }

        edits.push({ at: at + edits.reduce((sum, edit) => sum + edit.delta, 0), delta: expression.length - name.length });

        return expression;
    });

    return { text, shift: (pos) => pos - edits.filter((edit) => edit.at < pos).reduce((sum, edit) => sum + edit.delta, 0) };
}

const method = (label: string, detail: string, info: string, args = ''): Completion => ({ label, detail, info, type: 'method', section: { name: 'Value methods', rank: 3 }, apply: insert(`${label}()`, args ? 1 : 0, false) });
const property = (label: string, detail: string, info: string): Completion => ({ label, detail, info, type: 'property', section: { name: 'Value methods', rank: 3 } });

/** Métodos comuns de valores (texto, lista, número): o editor não sabe o tipo, então mostra os mais usados. */
const VALUE_METHODS: Completion[] = [
    property('length', 'text · list', 'Number of characters or items'),
    method('map', 'list', 'New list with each item transformed: items.map((item) => item.id)', ' '),
    method('filter', 'list', 'Items that match: items.filter((item) => item.active)', ' '),
    method('find', 'list', 'First item that matches: items.find((item) => item.id === 1)', ' '),
    method('some', 'list', 'Whether any item matches', ' '),
    method('every', 'list', 'Whether all items match', ' '),
    method('forEach', 'list', 'Run code for each item', ' '),
    method('reduce', 'list', 'Combine the items into one value', ' '),
    method('join', 'list', "Join the items into text: items.join(', ')", ' '),
    method('at', 'list · text', 'Item or character at a position (-1 = last)', ' '),
    method('slice', 'list · text', 'Part of the list or text', ' '),
    method('includes', 'list · text', 'Whether it contains the value', ' '),
    method('indexOf', 'list · text', 'Position of the value (-1 when missing)', ' '),
    method('split', 'text', "Split text into a list: text.split(',')", ' '),
    method('trim', 'text', 'Remove spaces at both ends'),
    method('toLowerCase', 'text', 'Lowercase copy'),
    method('toUpperCase', 'text', 'Uppercase copy'),
    method('startsWith', 'text', 'Whether the text starts with the value', ' '),
    method('endsWith', 'text', 'Whether the text ends with the value', ' '),
    method('replace', 'text', 'Replace the first match (replaceAll for every match)', ' '),
    method('replaceAll', 'text', 'Replace every match', ' '),
    method('padStart', 'text', "Pad at the start: String(n).padStart(2, '0')", ' '),
    method('toFixed', 'number', 'Number as text with fixed decimals', ' '),
    method('toString', 'any', 'Value as text')
];

/** Raízes cujos membros já são sugeridos por outra fonte (globais do JavaScript, `otto`, `console`). */
const KNOWN_ROOTS = /^(otto|console|JSON|Math|Object|Array|Number|String|Date|Promise|Symbol|Map|Set|RegExp|Error|Boolean)$/;

/** `otto.environment.get('` lista só o ambiente; `otto.collectionVariables.…('` só a coleção; `otto.cookies.…('` os cookies. */
const SCOPED_ARGUMENT = /otto\.(environment|collectionVariables|cookies)\.(get|has|set|unset|remove)\(\s*(['"]?)([\w.$-]*)$/;

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
    const before = line.text.slice(0, context.pos - line.from);
    const scoped = SCOPED_ARGUMENT.exec(before);

    if (scoped) {
        return scopedArgument(context, scoped, data);
    }

    const expanded = expandAliases(context.state.sliceDoc(0, line.from), before);
    const analysis = completionContext(expanded.text);
    const from = line.from + ('from' in analysis ? expanded.shift(analysis.from) : 0);
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
            return valueMethods(context, before);
    }

    if (!options.length && analysis.type === 'member') {
        return valueMethods(context, before);
    }

    return options.length ? { from, options: boosted(options, phase), validFor: /^[\w$.\-[\]'@*?()=!<> ]*$/ } : null;
};

/** Depois de `valor.`: métodos comuns de texto, lista e número. */
function valueMethods(context: CompletionContext, before: string): CompletionResult | null {
    const match = /(?:([A-Za-z_$][\w$]*)|[)\]])\s*\.([\w$]*)$/.exec(before);

    if (!match || (match[1] && KNOWN_ROOTS.test(match[1]))) {
        return null;
    }

    return { from: context.pos - match[2]!.length, options: VALUE_METHODS, validFor: /^[\w$]*$/ };
}

/** Nomes do escopo certo para `otto.environment` / `otto.collectionVariables` / `otto.cookies`. */
function scopedArgument(context: CompletionContext, match: RegExpExecArray, data: TemplateCompletionData): CompletionResult | null {
    const [, api, , quoteChar, prefix] = match;
    const quoted = !!quoteChar;
    const from = context.pos - prefix!.length;
    const apply = (name: string) => (quoted ? name : quote(name));
    let options: Completion[];

    if (api === 'cookies') {
        options = (context.state.facet(scriptCompletionData).cookies?.() ?? []).map((name) => ({ label: name, detail: 'cookie', type: 'variable', section: SECTIONS['values'], apply: apply(name) }));
    } else {
        const scope = api === 'environment' ? 'env' : 'collection';

        options = data
            .variables()
            .filter((variable) => variable.scope === scope)
            .map((variable) => ({ label: variable.name, detail: `${variable.label} · ${variable.secret ? '••••' : variable.value || '(empty)'}`, type: 'variable', section: SECTIONS['variables'], apply: apply(variable.name) }));
    }

    return options.length ? { from, options, validFor: /^[\w.$-]*$/ } : null;
}

const snippet = (template: string, label: string, detail: string) => snippetCompletion(template, { label, detail, type: 'text', section: { name: 'Snippets', rank: 4 } });

const COMMON_SNIPPETS: Completion[] = [
    snippet("console.log('${label}', ${value});", 'log', 'Print to the Console tab'),
    snippet('try {\n\t${}\n} catch (error) {\n\tconsole.error(error.message);\n}', 'trycatch', 'Catch an error and log it'),
    snippet("const ${value} = otto.environment.get('${name}');", 'envget', 'Read an environment variable'),
    snippet("const ${value} = otto.variables.get('${name}');", 'varget', 'Read a variable (environment, folders, collection)'),
    snippet('await otto.sleep(${1000});', 'sleep', 'Wait (ms)')
];

const SNIPPETS: Record<ScriptPhase, Completion[]> = {
    preRequest: [
        ...COMMON_SNIPPETS,
        snippet("otto.request.setHeader('${Header}', ${value});", 'setheader', 'Add or replace a header'),
        snippet("otto.request.setHeader('Authorization', 'Bearer ' + otto.environment.get('${token}'));", 'bearer', 'Authorization: Bearer from an environment variable'),
        snippet("otto.request.setParam('${name}', ${value});", 'setparam', 'Add or replace a query parameter'),
        snippet('otto.request.setBody({\n\t${key}: ${value}\n});', 'jsonbody', 'Replace the body with JSON'),
        snippet("otto.request.setHeader('X-Timestamp', String(Date.now()));", 'timestamp', 'Send the current time in a header'),
        snippet("otto.request.setHeader('X-Request-Id', otto.uuid());", 'requestid', 'Send a unique id in a header'),
        snippet("otto.environment.set('${name}', ${value});", 'envset', 'Set an environment variable'),
        snippet("const ${login} = await otto.request('${}', { send: 'expired', maxAge: 600 }).response;", 'fromrequest', 'Response of another request'),
        snippet(
            "const ${login} = await otto.request('${}', { send: 'expired', maxAge: 600 }).response;\notto.request.setHeader('Authorization', 'Bearer ' + ${login}.json('$.access_token'));",
            'authfromlogin',
            'Token from a login request in the Authorization header'
        )
    ],
    postResponse: [
        ...COMMON_SNIPPETS,
        snippet("otto.environment.set('${name}', otto.response.json('${$.access_token}'));", 'envset', 'Save a response value in the environment'),
        snippet("otto.environment.set('${token}', otto.response.json('$.access_token'));\notto.environment.set('${token}_expires_at', String(Date.now() + otto.response.json('$.expires_in') * 1000));", 'savetoken', 'Save a token and when it expires'),
        snippet('if (otto.response.status === ${200}) {\n\t${}\n}', 'ifstatus', 'Check the status code'),
        snippet("if (otto.response.status !== ${200}) {\n\tthrow new Error('Expected ${200}, got ' + otto.response.status);\n}", 'assertstatus', 'Fail the script when the status is not the expected'),
        snippet("if (!(${condition})) {\n\tthrow new Error('${message}');\n}", 'assert', 'Fail the script when a condition is false'),
        snippet("const ${value} = otto.response.header('${Content-Type}');", 'header', 'Read a response header'),
        snippet("console.log(JSON.stringify(otto.response.json('$'), null, 2));", 'logjson', 'Print the response body as formatted JSON'),
        snippet("const ${items} = otto.response.json('${$.items}');\nfor (const ${item} of ${items}) {\n\t${}\n}", 'foreach', 'Loop over a list from the response')
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
