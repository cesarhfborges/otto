// Relatório de um job do GitHub Actions: lê o resultado de cada passo (contexto `steps`,
// recebido em STEPS) e publica annotations (notice com o resumo, error por passo que falhou,
// com a dica de como reproduzir localmente) e uma tabela no resumo do job (GITHUB_STEP_SUMMARY).
// Com ARTIFACTS_DIR, também lista os arquivos gerados e seus tamanhos.
//
// Uso: node scripts/ci-report.mjs "<título do job>"   (em um passo com `if: always()`)
import { appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// O que cada passo faz e como reproduzir a falha localmente, por `id` do passo no workflow.
const STEPS = {
    install: { label: 'Instalar dependências', what: 'npm ci a partir do package-lock.json', local: 'npm ci' },
    typecheck: { label: 'Typecheck', what: 'tsc do Electron e do Angular, sem emitir arquivos', local: 'npm run typecheck' },
    lint: { label: 'Lint', what: 'ESLint em todo o projeto', local: 'npm run lint' },
    build: { label: 'Build', what: 'Angular (ng build) + compilação do Electron', local: 'npm run build' },
    test: { label: 'Testes do Electron', what: 'node --test nos *.test.js compilados', local: 'npm run test:electron' },
    a11y: { label: 'Acessibilidade e CSP', what: 'axe-core no app real (claro e escuro) + violações de CSP no console', local: 'npm run build && npm run audit:a11y' },
    next: { label: 'Calcular versão', what: 'semantic-release em dry-run a partir dos Conventional Commits', local: 'node scripts/next-version.mjs' },
    set_version: { label: 'Aplicar versão', what: 'grava a versão calculada no package.json (sem commit/tag)', local: 'npm version <versão> --no-git-tag-version' },
    package: { label: 'Empacotar', what: 'electron-builder gera os instaladores', local: 'npm run dist:release' },
    upload: { label: 'Enviar artefatos', what: 'guarda os instaladores para o job publish', local: '' },
    download: { label: 'Baixar artefatos', what: 'junta os instaladores de todas as plataformas', local: '' },
    release: { label: 'Publicar release', what: 'semantic-release cria a tag e a release no GitHub', local: 'npx semantic-release --dry-run' }
};

const ICON = { success: '✅', failure: '❌', cancelled: '⚪', skipped: '⏭️' };

// Codificação dos workflow commands: https://docs.github.com/actions/reference/workflow-commands-for-github-actions
const escapeData = (value) => value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = (value) => escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
const annotate = (level, title, message) => console.log(`::${level} title=${escapeProperty(title)}::${escapeData(message)}`);

const formatSize = (bytes) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
};

const job = process.argv[2] ?? process.env.GITHUB_JOB ?? 'Job';
let steps = {};
try {
    steps = JSON.parse(process.env.STEPS ?? '{}');
} catch {
    annotate('warning', `${job}: relatório`, 'Não foi possível ler o resultado dos passos (STEPS inválido).');
}

const results = Object.entries(steps)
    .filter(([id]) => id in STEPS)
    .map(([id, step]) => ({ id, ...STEPS[id], outcome: step.outcome ?? 'skipped' }));

const failed = results.filter((step) => step.outcome === 'failure');
const passed = results.filter((step) => step.outcome === 'success');

// Notice com a visão geral do job, um passo por linha.
const overview = results.map((step) => `${ICON[step.outcome] ?? '•'} ${step.label}: ${step.what}`).join('\n');
const headline = failed.length ? `${failed.length} de ${results.length} passos falharam` : `${passed.length} de ${results.length} passos concluídos`;
annotate(failed.length ? 'warning' : 'notice', `${job}: ${headline}`, overview || 'Nenhum passo registrado.');

// Um error por passo que falhou, com o comando para reproduzir.
for (const step of failed) {
    const hint = step.local ? `\nPara reproduzir localmente: ${step.local}` : '';
    annotate('error', `${job}: ${step.label} falhou`, `${step.what}.${hint}\nVeja o log do passo "${step.label}" para os detalhes.`);
}

// Artefatos gerados (instaladores), com tamanho.
const artifactsDir = process.env.ARTIFACTS_DIR;
let artifacts = [];
if (artifactsDir && existsSync(artifactsDir)) {
    artifacts = readdirSync(artifactsDir)
        .map((name) => ({ name, stat: statSync(path.join(artifactsDir, name)) }))
        .filter(({ name, stat }) => stat.isFile() && !/\.(blockmap|ya?ml)$/.test(name))
        .map(({ name, stat }) => ({ name, size: formatSize(stat.size) }))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (artifacts.length) {
        annotate('notice', `${job}: ${artifacts.length} ${artifacts.length === 1 ? 'arquivo gerado' : 'arquivos gerados'}`, artifacts.map((file) => `📦 ${file.name} (${file.size})`).join('\n'));
    }
}

// Resumo do job (aba Summary da execução).
if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
        `### ${failed.length ? '❌' : '✅'} ${job}`,
        '',
        '| | Passo | O que faz | Reproduzir localmente |',
        '|---|---|---|---|',
        ...results.map((step) => `| ${ICON[step.outcome] ?? ''} | ${step.label} | ${step.what} | ${step.local ? `\`${step.local}\`` : '—'} |`)
    ];

    if (artifacts.length) {
        lines.push('', '**Arquivos gerados**', '', '| Arquivo | Tamanho |', '|---|---|', ...artifacts.map((file) => `| \`${file.name}\` | ${file.size} |`));
    }

    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`);
}
