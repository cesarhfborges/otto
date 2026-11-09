import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DesktopEntryStatus } from '../../../shared/models';

/** Ícone redimensionado para o tamanho padrão do tema `hicolor`. */
export type IconRenderer = (size: number) => Buffer | null;

export interface DesktopEntryOptions {
    platform: NodeJS.Platform;
    isPackaged: boolean;
    /** Caminho do `.AppImage` (variável `APPIMAGE` definida pelo runtime do AppImage). */
    appImage: string | undefined;
    /** Binário do app instalado pelo `.deb` (`/opt/Otto/otto`). */
    execPath: string;
    /** Nome exibido no menu (`Otto` ou `Otto Beta`). */
    appName: string;
    /** Nome do executável/pacote Linux (`otto` ou `otto-beta`): base do `.desktop` e do ícone. */
    executableName: string;
    comment: string;
    /** `$XDG_DATA_HOME` (padrão `~/.local/share`). */
    dataHome?: string;
    /** `$XDG_DATA_DIRS` (padrão `/usr/local/share:/usr/share`): onde o `.deb` instala o atalho. */
    dataDirs?: string;
    icon: IconRenderer;
}

const ICON_SIZE = 256;

/**
 * Atalho do menu de aplicativos no Linux (freedesktop `.desktop`).
 *
 * O `.deb` já instala `/usr/share/applications/<exe>.desktop`; o AppImage não instala
 * nada, então o usuário pode criar (ou corrigir) a entrada em `~/.local/share/applications`.
 */
export class DesktopEntryService {
    constructor(private readonly options: DesktopEntryOptions) {}

    private get mode(): DesktopEntryStatus['mode'] {
        const { platform, isPackaged, appImage } = this.options;

        if (platform !== 'linux' || !isPackaged) {
            return null;
        }

        return appImage ? 'appimage' : 'package';
    }

    private get executable(): string {
        return this.options.appImage ?? this.options.execPath;
    }

    private get dataHome(): string {
        return this.options.dataHome || path.join(os.homedir(), '.local', 'share');
    }

    private get applicationsDir(): string {
        return path.join(this.dataHome, 'applications');
    }

    private get defaultEntryPath(): string {
        return path.join(this.applicationsDir, `${this.options.executableName}.desktop`);
    }

    private get iconPath(): string {
        return path.join(this.dataHome, 'icons', 'hicolor', `${ICON_SIZE}x${ICON_SIZE}`, 'apps', `${this.options.executableName}.png`);
    }

    async status(): Promise<DesktopEntryStatus> {
        const mode = this.mode;

        if (!mode) {
            return { mode: null, state: 'unsupported', path: null, executable: null, issues: [] };
        }

        const executable = this.executable;
        const entry = await this.findUserEntry();

        if (entry) {
            const issues = await this.validate(entry.content);

            return { mode, state: issues.length ? 'invalid' : 'installed', path: entry.file, executable, issues };
        }

        if (mode === 'package') {
            const system = await this.findSystemEntry();

            if (system) {
                return { mode, state: 'system', path: system, executable, issues: [] };
            }
        }

        return { mode, state: 'missing', path: this.defaultEntryPath, executable, issues: [] };
    }

    /** Cria a entrada (ou reescreve a existente com problemas) apontando para esta execução. */
    async install(): Promise<DesktopEntryStatus> {
        const current = await this.status();

        if (current.state === 'unsupported') {
            throw new Error('Desktop entries are only available for the packaged Linux app');
        }

        const file = current.state === 'installed' || current.state === 'invalid' ? current.path! : this.defaultEntryPath;
        const icon = await this.writeIcon();

        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, this.render(icon), { encoding: 'utf8', mode: 0o644 });
        await this.refreshDatabase();

        return this.status();
    }

    /** Remove a entrada do usuário (a do pacote `.deb` em `/usr/share` não é tocada). */
    async remove(): Promise<DesktopEntryStatus> {
        const current = await this.status();

        if ((current.state === 'installed' || current.state === 'invalid') && current.path) {
            await fs.rm(current.path, { force: true });
            await fs.rm(this.iconPath, { force: true });
            await this.refreshDatabase();
        }

        return this.status();
    }

    /**
     * Procura a entrada do usuário: primeiro pelo nome padrão; depois, qualquer `.desktop`
     * que execute este mesmo AppImage (atalhos criados à mão com outro nome).
     */
    private async findUserEntry(): Promise<{ file: string; content: string } | null> {
        const preferred = await readText(this.defaultEntryPath);

        if (preferred !== null) {
            return { file: this.defaultEntryPath, content: preferred };
        }

        let names: string[];

        try {
            names = (await fs.readdir(this.applicationsDir)).filter((name) => name.endsWith('.desktop'));
        } catch {
            return null;
        }

        const entries: Array<{ file: string; content: string; entry: Record<string, string> }> = [];

        for (const name of names) {
            const file = path.join(this.applicationsDir, name);
            const content = await readText(file);

            if (content !== null) {
                entries.push({ file, content, entry: parseDesktopEntry(content) });
            }
        }

        // Mesmo programa; senão, um AppImage com o mesmo nome de app (provavelmente movido de lugar).
        const match =
            entries.find(({ entry }) => execTarget(entry['Exec']) === this.executable) ??
            entries.find(({ entry }) => entry['Name'] === this.options.appName && /\.appimage$/i.test(execTarget(entry['Exec']) ?? ''));

        return match ? { file: match.file, content: match.content } : null;
    }

    private async findSystemEntry(): Promise<string | null> {
        const dirs = (this.options.dataDirs || '/usr/local/share:/usr/share').split(':').filter(Boolean);

        for (const dir of dirs) {
            const file = path.join(dir, 'applications', `${this.options.executableName}.desktop`);

            if (await exists(file)) {
                return file;
            }
        }

        return null;
    }

    private async validate(content: string): Promise<string[]> {
        const entry = parseDesktopEntry(content);
        const issues: string[] = [];

        if (!Object.keys(entry).length) {
            issues.push('The file has no [Desktop Entry] section.');

            return issues;
        }

        if (entry['Type'] !== 'Application') {
            issues.push('"Type" must be "Application".');
        }

        if (!entry['Name']) {
            issues.push('"Name" is missing.');
        }

        const target = execTarget(entry['Exec']);

        if (!target) {
            issues.push('"Exec" is missing.');
        } else if (target !== this.executable) {
            issues.push(`"Exec" points to ${target}, but ${this.options.appName} is running from ${this.executable}.`);
        }

        const icon = entry['Icon'];

        if (!icon) {
            issues.push('"Icon" is missing.');
        } else if (path.isAbsolute(icon) && !(await exists(icon))) {
            issues.push(`The icon file ${icon} does not exist.`);
        }

        if (entry['StartupWMClass'] !== this.options.appName) {
            issues.push(`"StartupWMClass" should be "${this.options.appName}" so the open window is grouped with the launcher.`);
        }

        if (entry['Hidden'] === 'true' || entry['NoDisplay'] === 'true') {
            issues.push('The entry is hidden from the applications menu.');
        }

        return issues;
    }

    /** Instala o ícone no tema `hicolor` do usuário; sem ícone renderizável, usa o nome do tema. */
    private async writeIcon(): Promise<string> {
        const png = this.options.icon(ICON_SIZE);

        if (!png) {
            return this.options.executableName;
        }

        await fs.mkdir(path.dirname(this.iconPath), { recursive: true });
        await fs.writeFile(this.iconPath, png);

        return this.iconPath;
    }

    private render(icon: string): string {
        const { appName, comment } = this.options;
        const lines = [
            '[Desktop Entry]',
            'Type=Application',
            `Name=${escapeString(appName)}`,
            'GenericName=API Client',
            `Comment=${escapeString(comment)}`,
            `Exec=${escapeString(quoteExecArg(this.executable))} %U`,
            `Icon=${escapeString(icon)}`,
            'Terminal=false',
            'StartupNotify=true',
            `StartupWMClass=${escapeString(appName)}`,
            'Categories=Development;Utility;',
            'Keywords=api;rest;http;graphql;client;openapi;'
        ];

        return `${lines.join('\n')}\n`;
    }

    /** Atualiza o cache de MIME/atalhos; ausente em várias distros, então falhas são ignoradas. */
    private refreshDatabase(): Promise<void> {
        return new Promise((resolve) => execFile('update-desktop-database', [this.applicationsDir], { timeout: 5000 }, () => resolve()));
    }
}

async function readText(file: string): Promise<string | null> {
    try {
        return await fs.readFile(file, 'utf8');
    } catch {
        return null;
    }
}

async function exists(file: string): Promise<boolean> {
    try {
        await fs.access(file);

        return true;
    } catch {
        return false;
    }
}

/** Chaves do grupo `[Desktop Entry]` (sem as variantes localizadas `Name[pt_BR]`). */
export function parseDesktopEntry(content: string): Record<string, string> {
    const entry: Record<string, string> = {};
    let inGroup = false;

    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        if (line.startsWith('[')) {
            inGroup = line === '[Desktop Entry]';
            continue;
        }

        const eq = line.indexOf('=');

        if (inGroup && eq > 0) {
            const key = line.slice(0, eq).trim();

            if (!key.includes('[') && !(key in entry)) {
                entry[key] = unescapeString(line.slice(eq + 1).trim());
            }
        }
    }

    return entry;
}

/** Primeiro argumento do `Exec` (o programa), sem aspas nem escapes. */
export function execTarget(exec: string | undefined): string | null {
    if (!exec) {
        return null;
    }

    const value = exec.trim();

    if (!value.startsWith('"')) {
        return value.split(/\s+/)[0].replace(/%%/g, '%') || null;
    }

    let result = '';

    for (let i = 1; i < value.length; i++) {
        const char = value[i];

        if (char === '\\' && i + 1 < value.length) {
            result += value[++i];
        } else if (char === '"') {
            return result.replace(/%%/g, '%');
        } else {
            result += char;
        }
    }

    return null;
}

/** Escapes de valores do tipo string (`\\`, `\n`, `\t`, `\r`, `\s`). */
function escapeString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function unescapeString(value: string): string {
    return value.replace(/\\([\\nrts])/g, (_match, char: string) => ({ n: '\n', r: '\r', t: '\t', s: ' ' })[char] ?? char);
}

/** Argumento do `Exec` entre aspas, com os caracteres reservados escapados (spec freedesktop). */
function quoteExecArg(value: string): string {
    return `"${value.replace(/([\\"`$])/g, '\\$1').replace(/%/g, '%%')}"`;
}
