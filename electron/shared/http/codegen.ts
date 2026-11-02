import type { HttpRequest } from '../models/http';

export const CODEGEN_TARGETS = [
    { id: 'curl', label: 'cURL', language: 'shell' },
    { id: 'httpie', label: 'HTTPie', language: 'shell' },
    { id: 'fetch', label: 'JavaScript (fetch)', language: 'javascript' },
    { id: 'axios', label: 'JavaScript (axios)', language: 'javascript' },
    { id: 'python', label: 'Python (requests)', language: 'python' },
    { id: 'go', label: 'Go (net/http)', language: 'go' },
    { id: 'php-curl', label: 'PHP (cURL)', language: 'php' },
    { id: 'php-guzzle', label: 'PHP (Guzzle)', language: 'php' },
    { id: 'java', label: 'Java (HttpClient)', language: 'java' },
    { id: 'csharp', label: 'C# (HttpClient)', language: 'csharp' },
    { id: 'kotlin', label: 'Kotlin (OkHttp)', language: 'kotlin' },
    { id: 'ruby', label: 'Ruby (Net::HTTP)', language: 'ruby' },
    { id: 'rust', label: 'Rust (reqwest)', language: 'rust' },
    { id: 'swift', label: 'Swift (URLSession)', language: 'swift' },
    { id: 'dart', label: 'Dart (http)', language: 'dart' },
    { id: 'powershell', label: 'PowerShell', language: 'powershell' }
] as const;

export type CodegenTarget = (typeof CODEGEN_TARGETS)[number]['id'];

/** Aspas simples do shell POSIX: `'` vira `'\''`. */
const shell = (text: string): string => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);

/** Literal de string JSON (também válido em JS, Python e Go). */
const str = (text: string): string => JSON.stringify(text);

const psString = (text: string): string => `'${text.replace(/'/g, "''")}'`;

const hex = (code: number, width: number): string => code.toString(16).padStart(width, '0');

/**
 * Literal entre aspas duplas no estilo C. `unicode` formata os demais caracteres de controle
 * (`\uXXXX` por padrão; Swift, Rust e PHP usam `\u{XX}`) e `interpolation` escapa o que a
 * linguagem interpolaria dentro da string (`$` em PHP/Kotlin/Dart, `#{` em Ruby).
 */
function quote(text: string, options: { unicode?: (code: number) => string; interpolation?: RegExp } = {}): string {
    const unicode = options.unicode ?? ((code: number) => `\\u${hex(code, 4)}`);
    let out = text
        .replace(/[\\"]/g, '\\$&')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, (ch) => unicode(ch.charCodeAt(0)));

    if (options.interpolation) {
        out = out.replace(options.interpolation, '\\$&');
    }

    return `"${out}"`;
}

const braceUnicode = (code: number): string => `\\u{${hex(code, 2)}}`;
const phpStr = (text: string): string => quote(text, { unicode: braceUnicode, interpolation: /\$/g });
const kotlinStr = (text: string): string => quote(text, { interpolation: /\$/g });
const dartStr = kotlinStr;
const rubyStr = (text: string): string => quote(text, { interpolation: /#(?=[{$@])/g });
const swiftStr = (text: string): string => quote(text, { unicode: braceUnicode });
const rustStr = swiftStr;
/** Java e C# aceitam os escapes do JSON (`\b`, `\f`, `\uXXXX`). */
const cStr = str;

/** Nome do arquivo de um caminho (Windows ou POSIX), para o `filename` de partes multipart. */
const baseName = (file: string): string => file.split(/[\\/]/).pop() ?? file;

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

const comment = (prefix: string, request: HttpRequest, extra: string[] = []): string =>
    [...extra, ...notes(request)].map((line) => `${prefix} ${line}\n`).join('');

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

function phpCurl(request: HttpRequest): string {
    const options = [`CURLOPT_URL => ${phpStr(request.url)}`, `CURLOPT_CUSTOMREQUEST => ${phpStr(request.method)}`, 'CURLOPT_RETURNTRANSFER => true'];
    const headers = headerEntries(request);

    if (headers.length) {
        options.push(`CURLOPT_HTTPHEADER => [\n${headers.map(([name, value]) => `        ${phpStr(`${name}: ${value}`)},`).join('\n')}\n    ]`);
    }

    if (request.multipart) {
        const fields = request.multipart.map((part) => `        ${phpStr(part.name)} => ${part.file ? `new CURLFile(${phpStr(part.value)})` : phpStr(part.value)},`);

        options.push(`CURLOPT_POSTFIELDS => [\n${fields.join('\n')}\n    ]`);
    } else if (request.bodyFile) {
        options.push(`CURLOPT_POSTFIELDS => file_get_contents(${phpStr(request.bodyFile)})`);
    } else if (request.body !== undefined) {
        options.push(`CURLOPT_POSTFIELDS => ${phpStr(request.body)}`);
    }

    return [
        '<?php',
        '',
        `${comment('//', request)}$ch = curl_init();`,
        '',
        `curl_setopt_array($ch, [\n    ${options.join(',\n    ')},\n]);`,
        '',
        '$response = curl_exec($ch);',
        '$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);',
        'curl_close($ch);',
        '',
        'echo $status, PHP_EOL, $response;'
    ].join('\n');
}

function phpGuzzle(request: HttpRequest): string {
    // Sem `http_errors`, o Guzzle lança exceção em 4xx/5xx em vez de devolver a resposta.
    const options = ["'http_errors' => false"];
    const headers = headerEntries(request);

    if (headers.length) {
        options.push(`'headers' => [\n${headers.map(([name, value]) => `        ${phpStr(name)} => ${phpStr(value)},`).join('\n')}\n    ]`);
    }

    if (request.multipart) {
        const parts = request.multipart.map((part) => `        ['name' => ${phpStr(part.name)}, 'contents' => ${part.file ? `fopen(${phpStr(part.value)}, 'r')` : phpStr(part.value)}],`);

        options.push(`'multipart' => [\n${parts.join('\n')}\n    ]`);
    } else if (request.bodyFile) {
        options.push(`'body' => fopen(${phpStr(request.bodyFile)}, 'r')`);
    } else if (request.body !== undefined) {
        options.push(`'body' => ${phpStr(request.body)}`);
    }

    return [
        '<?php',
        '',
        `${comment('//', request)}require 'vendor/autoload.php';`,
        '',
        'use GuzzleHttp\\Client;',
        '',
        '$client = new Client();',
        '',
        `$response = $client->request(${phpStr(request.method)}, ${phpStr(request.url)}, [\n    ${options.join(',\n    ')},\n]);`,
        '',
        'echo $response->getStatusCode(), PHP_EOL, $response->getBody();'
    ].join('\n');
}

/** Cabeçalhos que o `java.net.http.HttpClient` recusa (IllegalArgumentException): ele mesmo os define. */
const JAVA_RESTRICTED_HEADERS = new Set(['connection', 'content-length', 'expect', 'host', 'upgrade']);

function java(request: HttpRequest): string {
    const headers = headerEntries(request).filter(([name]) => !JAVA_RESTRICTED_HEADERS.has(name.toLowerCase()));
    const extra = request.multipart ? ['java.net.http has no multipart support: build the body (e.g. with Apache HttpClient MIME) and send it here.'] : [];
    const imports = ['java.net.URI', 'java.net.http.HttpClient', 'java.net.http.HttpRequest', 'java.net.http.HttpResponse', ...(request.bodyFile ? ['java.nio.file.Path'] : [])];
    const publisher = request.bodyFile
        ? `HttpRequest.BodyPublishers.ofFile(Path.of(${cStr(request.bodyFile)}))`
        : request.body !== undefined && !request.multipart
          ? `HttpRequest.BodyPublishers.ofString(${cStr(request.body)})`
          : 'HttpRequest.BodyPublishers.noBody()';
    const builder = [`HttpRequest.newBuilder()`, `.uri(URI.create(${cStr(request.url)}))`, ...headers.map(([name, value]) => `.header(${cStr(name)}, ${cStr(value)})`), `.method(${cStr(request.method)}, ${publisher})`, '.build();'];

    return [
        `${comment('//', request, extra)}${imports.map((name) => `import ${name};`).join('\n')}`,
        '',
        'public class Main {',
        '    public static void main(String[] args) throws Exception {',
        `        HttpRequest request = ${builder.join('\n            ')}`,
        '',
        '        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());',
        '',
        '        System.out.println(response.statusCode());',
        '        System.out.println(response.body());',
        '    }',
        '}'
    ].join('\n');
}

function csharp(request: HttpRequest): string {
    const lines = ['using var client = new HttpClient();', `using var request = new HttpRequestMessage(new HttpMethod(${cStr(request.method)}), ${cStr(request.url)});`];
    const headers = headerEntries(request);
    // Cabeçalhos Content-* pertencem ao conteúdo, não à mensagem.
    const isContentHeader = (name: string): boolean => name.toLowerCase().startsWith('content-');
    let hasContent = true;

    if (request.multipart) {
        lines.push('', 'var form = new MultipartFormDataContent();');

        for (const part of request.multipart) {
            lines.push(
                part.file
                    ? `form.Add(new StreamContent(File.OpenRead(${cStr(part.value)})), ${cStr(part.name)}, ${cStr(baseName(part.value))});`
                    : `form.Add(new StringContent(${cStr(part.value)}), ${cStr(part.name)});`
            );
        }

        lines.push('request.Content = form;');
    } else if (request.bodyFile) {
        lines.push('', `request.Content = new StreamContent(File.OpenRead(${cStr(request.bodyFile)}));`);
    } else if (request.body !== undefined) {
        lines.push('', `request.Content = new StringContent(${cStr(request.body)});`);
    } else {
        hasContent = false;
    }

    const messageHeaders = headers.filter(([name]) => !isContentHeader(name));
    // O multipart define o próprio Content-Type (com o boundary).
    const contentHeaders = hasContent ? headers.filter(([name]) => isContentHeader(name) && !(request.multipart && name.toLowerCase() === 'content-type')) : [];

    if (messageHeaders.length || contentHeaders.length) {
        lines.push('');
    }

    lines.push(...messageHeaders.map(([name, value]) => `request.Headers.TryAddWithoutValidation(${cStr(name)}, ${cStr(value)});`));

    for (const [name, value] of contentHeaders) {
        lines.push(`request.Content!.Headers.Remove(${cStr(name)});`, `request.Content!.Headers.TryAddWithoutValidation(${cStr(name)}, ${cStr(value)});`);
    }

    lines.push('', 'using var response = await client.SendAsync(request);', '', 'Console.WriteLine((int)response.StatusCode);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');

    return comment('//', request) + lines.join('\n');
}

/** Métodos em que o OkHttp proíbe corpo (GET/HEAD) ou o exige (POST, PUT, PATCH...). */
const OKHTTP_NO_BODY = new Set(['GET', 'HEAD']);
const OKHTTP_REQUIRES_BODY = new Set(['POST', 'PUT', 'PATCH', 'PROPPATCH', 'REPORT']);

function kotlin(request: HttpRequest): string {
    const method = request.method.toUpperCase();
    const imports = ['okhttp3.OkHttpClient', 'okhttp3.Request'];
    const extra: string[] = [];
    const lines: string[] = [];
    let body: string | null = null;

    if (OKHTTP_NO_BODY.has(method)) {
        if (request.body !== undefined || request.bodyFile || request.multipart) {
            extra.push(`OkHttp does not allow a body on ${method}: it was left out.`);
        }
    } else if (request.multipart) {
        imports.push('okhttp3.MultipartBody');

        if (request.multipart.some((part) => part.file)) {
            imports.push('okhttp3.RequestBody.Companion.asRequestBody', 'java.io.File');
        }

        const parts = request.multipart.map((part) =>
            part.file ? `.addFormDataPart(${kotlinStr(part.name)}, ${kotlinStr(baseName(part.value))}, File(${kotlinStr(part.value)}).asRequestBody())` : `.addFormDataPart(${kotlinStr(part.name)}, ${kotlinStr(part.value)})`
        );

        lines.push(`    val body = MultipartBody.Builder()\n        .setType(MultipartBody.FORM)\n        ${parts.join('\n        ')}\n        .build()`);
        body = 'body';
    } else if (request.bodyFile) {
        imports.push('okhttp3.RequestBody.Companion.asRequestBody', 'java.io.File');
        lines.push(`    val body = File(${kotlinStr(request.bodyFile)}).asRequestBody()`);
        body = 'body';
    } else if (request.body !== undefined) {
        imports.push('okhttp3.RequestBody.Companion.toRequestBody');
        lines.push(`    val body = ${kotlinStr(request.body)}.toRequestBody()`);
        body = 'body';
    } else if (OKHTTP_REQUIRES_BODY.has(method)) {
        imports.push('okhttp3.RequestBody.Companion.toRequestBody');
        body = 'ByteArray(0).toRequestBody()';
    }

    const builder = ['Request.Builder()', `.url(${kotlinStr(request.url)})`, `.method(${kotlinStr(request.method)}, ${body ?? 'null'})`, ...headerEntries(request).map(([name, value]) => `.addHeader(${kotlinStr(name)}, ${kotlinStr(value)})`), '.build()'];

    return [
        `${comment('//', request, extra)}${imports.map((name) => `import ${name}`).join('\n')}`,
        '',
        'fun main() {',
        '    val client = OkHttpClient()',
        ...lines,
        `    val request = ${builder.join('\n        ')}`,
        '',
        '    client.newCall(request).execute().use { response ->',
        '        println(response.code)',
        '        println(response.body?.string())',
        '    }',
        '}'
    ].join('\n');
}

function ruby(request: HttpRequest): string {
    const hasBody = request.body !== undefined || !!request.bodyFile || !!request.multipart;
    const lines = [
        "require 'net/http'",
        "require 'uri'",
        '',
        `uri = URI(${rubyStr(request.url)})`,
        `request = Net::HTTPGenericRequest.new(${rubyStr(request.method)}, ${hasBody}, ${request.method.toUpperCase() !== 'HEAD'}, uri)`,
        ...headerEntries(request).map(([name, value]) => `request[${rubyStr(name)}] = ${rubyStr(value)}`)
    ];

    if (request.multipart) {
        const parts = request.multipart.map((part) => `  [${rubyStr(part.name)}, ${part.file ? `File.open(${rubyStr(part.value)})` : rubyStr(part.value)}],`);

        lines.push(`request.set_form([\n${parts.join('\n')}\n], 'multipart/form-data')`);
    } else if (request.bodyFile) {
        lines.push(`request.body = File.binread(${rubyStr(request.bodyFile)})`);
    } else if (request.body !== undefined) {
        lines.push(`request.body = ${rubyStr(request.body)}`);
    }

    lines.push('', "response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') do |http|", '  http.request(request)', 'end', '', 'puts response.code', 'puts response.body');

    return comment('#', request) + lines.join('\n');
}

function rust(request: HttpRequest): string {
    const features = ['blocking', ...(request.multipart ? ['multipart'] : [])];
    const builder = ['client', `.request(reqwest::Method::from_bytes(${rustStr(request.method)}.as_bytes())?, ${rustStr(request.url)})`, ...headerEntries(request).map(([name, value]) => `.header(${rustStr(name)}, ${rustStr(value)})`)];
    const lines: string[] = [];

    if (request.multipart) {
        const parts = request.multipart.map((part) => (part.file ? `.file(${rustStr(part.name)}, ${rustStr(part.value)})?` : `.text(${rustStr(part.name)}, ${rustStr(part.value)})`));

        lines.push(`    let form = reqwest::blocking::multipart::Form::new()\n        ${parts.join('\n        ')};`, '');
        builder.push('.multipart(form)');
    } else if (request.bodyFile) {
        builder.push(`.body(std::fs::read(${rustStr(request.bodyFile)})?)`);
    } else if (request.body !== undefined) {
        builder.push(`.body(${rustStr(request.body)})`);
    }

    builder.push('.send()?;');

    return [
        `${comment('//', request, [`Cargo.toml: reqwest = { version = "0.12", features = [${features.map((f) => `"${f}"`).join(', ')}] }`])}fn main() -> Result<(), Box<dyn std::error::Error>> {`,
        '    let client = reqwest::blocking::Client::new();',
        ...lines,
        `    let response = ${builder.join('\n        ')}`,
        '',
        '    println!("{}", response.status());',
        '    println!("{}", response.text()?);',
        '',
        '    Ok(())',
        '}'
    ].join('\n');
}

function swift(request: HttpRequest): string {
    const extra = request.multipart ? ['URLSession has no multipart builder: encode the form body and set it in httpBody.'] : [];
    const lines = [
        'import Foundation',
        '',
        `var request = URLRequest(url: URL(string: ${swiftStr(request.url)})!)`,
        `request.httpMethod = ${swiftStr(request.method)}`,
        ...headerEntries(request).map(([name, value]) => `request.setValue(${swiftStr(value)}, forHTTPHeaderField: ${swiftStr(name)})`)
    ];

    if (request.bodyFile) {
        lines.push(`request.httpBody = try Data(contentsOf: URL(fileURLWithPath: ${swiftStr(request.bodyFile)}))`);
    } else if (request.body !== undefined && !request.multipart) {
        lines.push(`request.httpBody = Data(${swiftStr(request.body)}.utf8)`);
    }

    lines.push(
        '',
        'let (data, response) = try await URLSession.shared.data(for: request)',
        '',
        'print((response as! HTTPURLResponse).statusCode)',
        'print(String(decoding: data, as: UTF8.self))'
    );

    return comment('//', request, extra) + lines.join('\n');
}

function dart(request: HttpRequest): string {
    const headers = headerEntries(request);
    const usesFile = !!request.bodyFile;
    const lines = [...(usesFile ? ["import 'dart:io';", ''] : []), "import 'package:http/http.dart' as http;", '', 'Future<void> main() async {'];
    const headerLines = headers.length ? [`  request.headers.addAll({\n${headers.map(([name, value]) => `    ${dartStr(name)}: ${dartStr(value)},`).join('\n')}\n  });`] : [];

    if (request.multipart) {
        lines.push(`  final request = http.MultipartRequest(${dartStr(request.method)}, Uri.parse(${dartStr(request.url)}));`, ...headerLines);

        for (const part of request.multipart) {
            lines.push(
                part.file ? `  request.files.add(await http.MultipartFile.fromPath(${dartStr(part.name)}, ${dartStr(part.value)}));` : `  request.fields[${dartStr(part.name)}] = ${dartStr(part.value)};`
            );
        }
    } else {
        lines.push(`  final request = http.Request(${dartStr(request.method)}, Uri.parse(${dartStr(request.url)}));`, ...headerLines);

        if (request.bodyFile) {
            lines.push(`  request.bodyBytes = await File(${dartStr(request.bodyFile)}).readAsBytes();`);
        } else if (request.body !== undefined) {
            lines.push(`  request.body = ${dartStr(request.body)};`);
        }
    }

    lines.push('', '  final response = await http.Response.fromStream(await request.send());', '', '  print(response.statusCode);', '  print(response.body);', '}');

    return comment('//', request) + lines.join('\n');
}

const GENERATORS: Record<CodegenTarget, (request: HttpRequest) => string> = {
    curl,
    httpie,
    fetch: fetchJs,
    axios,
    python,
    go,
    'php-curl': phpCurl,
    'php-guzzle': phpGuzzle,
    java,
    csharp,
    kotlin,
    ruby,
    rust,
    swift,
    dart,
    powershell
};

/** Código equivalente à requisição (já montada por `buildHttpRequest`). */
export function generateCode(request: HttpRequest, target: CodegenTarget): string {
    return GENERATORS[target](request);
}
