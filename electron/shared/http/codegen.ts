import type { HttpRequest } from '../models/http';

export const CODEGEN_TARGETS = [
    { id: 'curl', label: 'cURL', language: 'shell' },
    { id: 'httpie', label: 'HTTPie', language: 'shell' },
    { id: 'fetch', label: 'JavaScript (fetch)', language: 'javascript' },
    { id: 'axios', label: 'JavaScript (axios)', language: 'javascript' },
    { id: 'python', label: 'Python (requests)', language: 'python' },
    { id: 'go', label: 'Go (net/http)', language: 'go' },
    { id: 'powershell', label: 'PowerShell', language: 'powershell' }
] as const;

export type CodegenTarget = (typeof CODEGEN_TARGETS)[number]['id'];

/** Aspas simples do shell POSIX: `'` vira `'\''`. */
const shell = (text: string): string => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);

/** Literal de string JSON (também válido em JS, Python e Go). */
const str = (text: string): string => JSON.stringify(text);

const psString = (text: string): string => `'${text.replace(/'/g, "''")}'`;

const indent = (text: string, spaces: number): string => text.replace(/\n/g, `\n${' '.repeat(spaces)}`);

const headerEntries = (request: HttpRequest): Array<[string, string]> => Object.entries(request.headers ?? {});

/** Avisos (no estilo de comentário da linguagem) para o que não dá para reproduzir fielmente. */
function notes(request: HttpRequest): string[] {
    const lines: string[] = [];

    if (request.auth) {
        lines.push(`Auth "${request.auth.type}" is computed by Otto at send time and is not included.`);
    }

    if (request.bodyFile) {
        lines.push(`Body is the file ${request.bodyFile}.`);
    }

    return lines;
}

const comment = (prefix: string, request: HttpRequest): string =>
    notes(request)
        .map((line) => `${prefix} ${line}\n`)
        .join('');

function curl(request: HttpRequest): string {
    const parts = [`curl -X ${request.method} ${shell(request.url)}`];

    for (const [name, value] of headerEntries(request)) {
        parts.push(`-H ${shell(`${name}: ${value}`)}`);
    }

    if (request.multipart) {
        for (const part of request.multipart) {
            parts.push(`-F ${shell(`${part.name}=${part.file ? '@' : ''}${part.value}`)}`);
        }
    } else if (request.bodyFile) {
        parts.push(`--data-binary ${shell(`@${request.bodyFile}`)}`);
    } else if (request.body !== undefined) {
        parts.push(`--data-raw ${shell(request.body)}`);
    }

    return comment('#', request) + parts.join(' \\\n  ');
}

function httpie(request: HttpRequest): string {
    const parts = [`http ${request.method} ${shell(request.url)}`];

    for (const [name, value] of headerEntries(request)) {
        parts.push(shell(`${name}:${value}`));
    }

    if (request.multipart) {
        parts.splice(0, 1, `http --multipart ${request.method} ${shell(request.url)}`);

        for (const part of request.multipart) {
            parts.push(shell(`${part.name}${part.file ? '@' : '='}${part.value}`));
        }
    }

    const body = request.bodyFile ? ` < ${shell(request.bodyFile)}` : request.body !== undefined && !request.multipart ? ` --raw ${shell(request.body)}` : '';

    return comment('#', request) + parts.join(' \\\n  ') + body;
}

function fetchJs(request: HttpRequest): string {
    const options: string[] = [`method: ${str(request.method)}`];
    const headers = headerEntries(request);
    let prelude = '';

    if (headers.length) {
        options.push(`headers: {\n${headers.map(([name, value]) => `    ${str(name)}: ${str(value)}`).join(',\n')}\n  }`);
    }

    if (request.multipart) {
        prelude = `const form = new FormData();\n${request.multipart.map((part) => `form.append(${str(part.name)}, ${part.file ? `/* file */ ${str(part.value)}` : str(part.value)});`).join('\n')}\n\n`;
        options.push('body: form');
    } else if (request.body !== undefined) {
        options.push(`body: ${str(request.body)}`);
    }

    return `${comment('//', request)}${prelude}const response = await fetch(${str(request.url)}, {\n  ${options.join(',\n  ')}\n});\n\nconsole.log(response.status, await response.text());`;
}

function axios(request: HttpRequest): string {
    const config: string[] = [`method: ${str(request.method.toLowerCase())}`, `url: ${str(request.url)}`];
    const headers = headerEntries(request);

    if (headers.length) {
        config.push(`headers: {\n${headers.map(([name, value]) => `    ${str(name)}: ${str(value)}`).join(',\n')}\n  }`);
    }

    if (request.body !== undefined && !request.multipart) {
        config.push(`data: ${str(request.body)}`);
    }

    return `${comment('//', request)}import axios from 'axios';\n\nconst response = await axios.request({\n  ${config.join(',\n  ')}\n});\n\nconsole.log(response.status, response.data);`;
}

function python(request: HttpRequest): string {
    const args = [str(request.method), str(request.url)];
    const headers = headerEntries(request);
    const lines = ['import requests', ''];

    if (headers.length) {
        lines.push(`headers = {\n${headers.map(([name, value]) => `    ${str(name)}: ${str(value)},`).join('\n')}\n}`);
        args.push('headers=headers');
    }

    if (request.multipart) {
        const files = request.multipart.filter((part) => part.file);
        const fields = request.multipart.filter((part) => !part.file);

        if (fields.length) {
            lines.push(`data = {\n${fields.map((part) => `    ${str(part.name)}: ${str(part.value)},`).join('\n')}\n}`);
            args.push('data=data');
        }

        if (files.length) {
            lines.push(`files = {\n${files.map((part) => `    ${str(part.name)}: open(${str(part.value)}, "rb"),`).join('\n')}\n}`);
            args.push('files=files');
        }
    } else if (request.bodyFile) {
        args.push(`data=open(${str(request.bodyFile)}, "rb")`);
    } else if (request.body !== undefined) {
        lines.push(`payload = ${str(request.body)}`);
        args.push('data=payload.encode("utf-8")');
    }

    lines.push('', `response = requests.request(${args.join(', ')})`, '', 'print(response.status_code, response.text)');

    return comment('#', request) + lines.join('\n');
}

function go(request: HttpRequest): string {
    const hasBody = request.body !== undefined && !request.multipart;
    const imports = ['"fmt"', '"io"', '"net/http"', ...(hasBody ? ['"strings"'] : [])];
    const lines = [
        'package main',
        '',
        `import (\n\t${imports.join('\n\t')}\n)`,
        '',
        'func main() {',
        ...(hasBody ? [`\tbody := strings.NewReader(${str(request.body ?? '')})`] : []),
        `\treq, err := http.NewRequest(${str(request.method)}, ${str(request.url)}, ${hasBody ? 'body' : 'nil'})`,
        '\tif err != nil {\n\t\tpanic(err)\n\t}',
        ...headerEntries(request).map(([name, value]) => `\treq.Header.Set(${str(name)}, ${str(value)})`),
        '',
        '\tres, err := http.DefaultClient.Do(req)',
        '\tif err != nil {\n\t\tpanic(err)\n\t}',
        '\tdefer res.Body.Close()',
        '',
        '\tdata, _ := io.ReadAll(res.Body)',
        '\tfmt.Println(res.Status, string(data))',
        '}'
    ];

    return comment('//', request) + lines.join('\n');
}

function powershell(request: HttpRequest): string {
    const lines: string[] = [];
    const headers = headerEntries(request);
    const args = [`-Method ${request.method}`, `-Uri ${psString(request.url)}`];

    if (headers.length) {
        lines.push(`$headers = @{\n${headers.map(([name, value]) => `    ${psString(name)} = ${psString(value)}`).join('\n')}\n}`);
        args.push('-Headers $headers');
    }

    if (request.bodyFile) {
        args.push(`-InFile ${psString(request.bodyFile)}`);
    } else if (request.body !== undefined && !request.multipart) {
        lines.push(`$body = ${psString(request.body)}`);
        args.push('-Body $body');
    }

    lines.push(`$response = Invoke-WebRequest ${indent(args.join(' `\n'), 4)}`, '$response.StatusCode', '$response.Content');

    return comment('#', request) + lines.join('\n');
}

const GENERATORS: Record<CodegenTarget, (request: HttpRequest) => string> = { curl, httpie, fetch: fetchJs, axios, python, go, powershell };

/** Código equivalente à requisição (já montada por `buildHttpRequest`). */
export function generateCode(request: HttpRequest, target: CodegenTarget): string {
    return GENERATORS[target](request);
}
