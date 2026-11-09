// Auditoria de acessibilidade (axe-core) no app real: abre o Electron já compilado
// (`npm run build`) com um perfil temporário, injeta o axe via DevTools Protocol e
// audita as telas principais nos temas claro e escuro. Também falha se o console
// mostrar violações de Content-Security-Policy ou erros não tratados.
//
// Uso: npm run build && npm run audit:a11y   (precisa de display; no Linux sem tela: xvfb-run)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electronPath from 'electron';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PORT = 9300 + Math.floor(Math.random() * 500);
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const profile = mkdtempSync(path.join(tmpdir(), 'otto-a11y-'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Servidor local para as requisições de teste (resposta, histórico).
const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, items: [1, 2, 3] }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const echoUrl = `http://127.0.0.1:${server.address().port}/items`;
const env = { ...process.env, HOME: profile, XDG_CONFIG_HOME: path.join(profile, '.config'), NODE_ENV: 'production' };

delete env.ELECTRON_RUN_AS_NODE;

// Em CI (GitHub Actions) o sandbox do Chromium não tem permissão de user namespaces.
const app = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`, ...(process.env.CI ? ['--no-sandbox'] : [])], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });

app.stderr.on('data', () => undefined);

/** Cliente mínimo do DevTools Protocol sobre o WebSocket nativo do Node. */
async function connect() {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
            const page = targets.find((target) => target.type === 'page' && !target.url.startsWith('devtools://'));

            if (page) {
                const socket = new WebSocket(page.webSocketDebuggerUrl);

                await new Promise((resolve, reject) => {
                    socket.onopen = resolve;
                    socket.onerror = reject;
                });

                return socket;
            }
        } catch {
            // O Electron ainda está subindo.
        }

        await sleep(200);
    }

    throw new Error('Could not connect to the Electron window');
}

const socket = await connect();
const pending = new Map();
const problems = [];
let nextId = 1;

socket.onmessage = (message) => {
    const data = JSON.parse(String(message.data));

    if (data.id && pending.has(data.id)) {
        pending.get(data.id)(data);
        pending.delete(data.id);
    } else if (data.method === 'Runtime.exceptionThrown') {
        problems.push(`Uncaught exception: ${data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text}`);
    } else if (data.method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(data.params.entry.text)) {
        problems.push(`CSP: ${data.params.entry.text}`);
    } else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
        const text = data.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');

        if (/Content Security Policy|Refused to/i.test(text)) {
            problems.push(`CSP: ${text}`);
        }
    }
};

const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const id = nextId++;

        pending.set(id, (data) => (data.error ? reject(new Error(`${method}: ${data.error.message}`)) : resolve(data.result)));
        socket.send(JSON.stringify({ id, method, params }));
    });

const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }

    return result.result.value;
};

const waitFor = async (expression, label, timeout = 15_000) => {
    for (const started = Date.now(); Date.now() - started < timeout; ) {
        if (await evaluate(expression).catch(() => false)) {
            return;
        }

        await sleep(150);
    }

    const tabs = await evaluate(`[...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()).join(' | ')`).catch(() => '?');

    throw new Error(`Timed out waiting for ${label} (visible tabs: ${tabs})`);
};

const press = async (key, code, modifiers = 0, keyCode = 0) => {
    for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: keyCode });
    }
};

let violations = 0;

async function audit(name) {
    await sleep(400);

    const result = await evaluate(
        `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} }, resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ') + ' — ' + (n.any.concat(n.all, n.none)[0]?.message ?? '') + ' — ' + n.html.slice(0, 160)) })))`
    );

    violations += result.length;
    console.log(`${result.length ? '✗' : '✓'} ${name}${result.length ? `: ${result.length} violation(s)` : ''}`);

    for (const violation of result) {
        console.log(`    [${violation.impact}] ${violation.id} — ${violation.help}`);

        for (const node of violation.nodes) {
            console.log(`        ${node}`);
        }
    }
}

const setTheme = (theme) => evaluate(`window.otto.settings.set({ theme: '${theme}' }).then(() => new Promise((r) => setTimeout(r, 300)))`);

const js = JSON.stringify;
const closeOverlay = async () => {
    const open = `!!document.querySelector('[role="dialog"], [role="alertdialog"]')`;

    await press('Escape', 'Escape', 0, 27);
    await sleep(300);

    // Sem foco dentro do diálogo o Escape não chega nele: fecha pelo botão.
    if (await evaluate(open)) {
        await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Close"], [role="alertdialog"] button[aria-label="Close"]')?.click()`);
    }

    await waitFor(`!(${open})`, 'the dialog to close');
};
/** Clica no primeiro elemento de `selector` cujo texto (ou aria-label) começa com `text`. */
const click = async (selector, text) => {
    const clicked = await evaluate(
        `(() => { const el = [...document.querySelectorAll(${js(selector)})].find((e) => (e.getAttribute('aria-label') ?? e.textContent).trim().startsWith(${js(text)})); (el?.querySelector('[data-pc-section="itemcontent"], .p-menuitem-content, .p-contextmenu-item-content') ?? el)?.click(); return !!el; })()`
    );

    if (!clicked) {
        throw new Error(`"${text}" (${selector}) not found`);
    }

    await sleep(300);
};
/** Ações da coleção aberta: botão ⋮ no cabeçalho da barra lateral. */
const collectionMenu = async (item) => {
    await evaluate(`document.querySelector('app-collections-sidebar button[aria-label="More collection actions"]').click()`);
    await waitFor(`!!document.querySelector('[role="menuitem"]')`, 'the collection menu');
    await click('[role="menuitem"]', item);
};
/** Volta à listagem de coleções (contexto do workspace), se houver uma coleção aberta. */
const backToCollections = async () => {
    await evaluate(`document.querySelector('app-collections-sidebar button[aria-label="Back to collections"]')?.click()`);
    await waitFor(`!document.querySelector('app-collections-sidebar button[aria-label="Back to collections"]')`, 'the collections list');
};
const treeItem = (level, text) => `[...document.querySelectorAll('[role="treeitem"][aria-level="${level}"] .p-tree-node-content')].find((e) => e.textContent.includes(${js(text)}))`;

/** Coleção de teste: requisição com exemplo (mock server) e ambiente com variável secreta (cofre). */
let seeded = null;

async function seed() {
    const collection = await evaluate(`window.otto.collections.createOnDisk('Audit').then((c) => c.metadata)`);

    seeded = collection;
    const request = {
        name: 'Items',
        method: 'GET',
        url: echoUrl,
        params: [{ key: 'page', value: '1', enabled: true }],
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        auth: { type: 'none' },
        body: { type: 'none' },
        docs: '',
        scripts: { preRequest: "otto.request.setHeader('X-Audit', otto.uuid());" },
        examples: [{ name: 'OK', status: 200, headers: [{ key: 'content-type', value: 'application/json', enabled: true }], body: '{"ok":true}' }]
    };

    await evaluate(`window.otto.collectionFiles.createRequest(${js(collection.id)}, '', ${js(request)})`);
    await evaluate(`window.otto.environments.create({ collectionId: ${js(collection.id)}, name: 'Dev', variables: [{ key: 'baseUrl', value: 'http://127.0.0.1', enabled: true, secret: false }, { key: 'token', value: 's3cr3t', enabled: true, secret: true }] })`);
    await evaluate('location.reload()');
    await sleep(1000);
    await waitFor(`!!document.querySelector('[role="tablist"]')`, 'the app shell after reload');
    await evaluate(AXE_SOURCE);
}

async function auditRequest(theme) {
    // Uma coleção por vez: entra pelo card no Overview do workspace; a árvore mostra só os itens dela.
    await waitFor(`!!document.querySelector('.otto-collection-card')`, 'the collection card');
    await click('.otto-collection-card', 'Audit');
    await waitFor(`!!${treeItem(1, 'Items')}`, 'the request in the sidebar');
    await evaluate(`${treeItem(1, 'Items')}.click()`);
    await waitFor(`!!document.querySelector('button[aria-label="Generate code"]')`, 'the request view');
    await audit(`Request editor (${theme})`);

    await click('button', 'Send');
    await waitFor(`[...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim().startsWith('Console'))`, 'the response', 20_000);
    await audit(`Response (${theme})`);

    await click('[role="tab"]', 'Console');
    await audit(`Response console (${theme})`);

    await click('[role="tab"]', 'History');
    await audit(`Request history (${theme})`);

    await click('[role="tab"]', 'Examples');
    await audit(`Examples (${theme})`);

    await click('button', 'Generate code');
    await waitFor(`!!document.querySelector('[role="dialog"]')`, 'the code dialog');
    await audit(`Generate code dialog (${theme})`);
    await closeOverlay();
}

async function auditCollection(theme) {
    // A página da coleção e os ambientes abrem pelo menu ⋮ da barra lateral.
    await collectionMenu('Overview');
    await waitFor(`[...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim().startsWith('Mock'))`, 'the collection page');
    await audit(`Collection overview (${theme})`);

    for (const tab of ['Auth', 'Headers', 'Variables', 'Cookies']) {
        await click('[role="tab"]', tab);
        await audit(`Collection ${tab.toLowerCase()} (${theme})`);
    }

    await click('[role="tab"]', 'Scripts');
    await audit(`Collection scripts (${theme})`);

    // Aba Security: confiável, depois com um script alterado por fora do app (diff e indicador).
    await click('[role="tab"]', 'Security');
    await waitFor(`!!document.querySelector('app-collection-security table')`, 'the security tab');
    await audit(`Collection security (${theme})`);

    const file = path.join(seeded.path, 'items.yaml');

    writeFileSync(file, readFileSync(file, 'utf8').replace('otto.uuid()', `otto.uuid() + '-${theme}'`));
    await waitFor(`(document.querySelector('app-script-security-indicator button')?.getAttribute('aria-label') ?? '').includes('changed')`, 'the changed scripts indicator');
    await audit(`Collection security with changed scripts (${theme})`);
    await click('button', 'Review Changes');
    await waitFor(`!!document.querySelector('[role="dialog"] app-diff-view')`, 'the script changes dialog');
    await audit(`Script changes dialog (${theme})`);
    await click('[role="dialog"] button', 'Trust Current Scripts');
    await waitFor(`(document.querySelector('app-script-security-indicator button')?.getAttribute('aria-label') ?? '').includes('trusted')`, 'the trusted indicator');

    // Menu de ações rápidas do indicador.
    await evaluate(`document.querySelector('app-script-security-indicator button').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
    await waitFor(`!!document.querySelector('[role="menuitem"]')`, 'the indicator menu');
    await audit(`Script security quick actions (${theme})`);
    await press('Escape', 'Escape', 0, 27);
    await sleep(300);

    await click('[role="tab"]', 'Mock');
    await audit(`Mock server (${theme})`);
    await click('button', 'Start mock server');
    await waitFor(`!!document.querySelector('app-mock-server-panel .pi-stop-circle')`, 'the mock server to start');
    await audit(`Mock server running (${theme})`);
    await evaluate(`document.querySelector('app-mock-server-panel .pi-stop-circle').closest('button').click()`);
    await waitFor(`!document.querySelector('app-mock-server-panel .pi-stop-circle')`, 'the mock server to stop');

    await click('[role="tab"]', 'OpenAPI');
    await click('button', 'Connect to OpenAPI Spec');
    await waitFor(`!!document.getElementById('preserve-values')`, 'the OpenAPI connection settings');
    await audit(`OpenAPI connection settings (${theme})`);
    await closeOverlay();

    await collectionMenu('Environments');
    await waitFor(`!!document.querySelector('app-environments-page li button')`, 'the environments page');
    await click('app-environments-page li button', 'Dev');
    await audit(`Environments and secrets (${theme})`);
}

try {
    await send('Runtime.enable');
    await send('Log.enable');
    await waitFor(`!!document.querySelector('app-root') && document.querySelector('app-root').children.length > 0 && !!document.querySelector('[role="tablist"]')`, 'the app shell');
    await seed();

    for (const theme of ['light', 'dark']) {
        await setTheme(theme);
        await backToCollections();
        await audit(`Workspace overview (${theme})`);

        // Preferences (diálogo aberto pela barra de status).
        await evaluate(`document.querySelector('button[aria-label="Preferences"]').click()`);
        await waitFor(`!!document.querySelector('[role="dialog"]')`, 'Preferences');
        await audit(`Preferences (${theme})`);
        await closeOverlay();

        // Paleta de comandos (Ctrl+K).
        await press('k', 'KeyK', process.platform === 'darwin' ? 4 : 2, 75);
        await waitFor(`!!document.querySelector('[role="combobox"]')`, 'the command palette');
        await audit(`Command palette (${theme})`);
        await press('Escape', 'Escape', 0, 27);

        await auditRequest(theme);
        await auditCollection(theme);
    }
} catch (error) {
    problems.push(String(error instanceof Error ? error.message : error));
} finally {
    socket.close();
    server.close();
    app.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
}

for (const problem of problems) {
    console.log(`✗ ${problem}`);
}

console.log(violations || problems.length ? `\nFailed: ${violations} accessibility violation(s), ${problems.length} other problem(s).` : '\nNo accessibility violations.');
process.exit(violations || problems.length ? 1 : 0);
