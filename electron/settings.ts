import { app, type Rectangle } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OttoSettings } from './shared/contract';

interface StoredState extends OttoSettings {
    windowBounds?: Rectangle;
}

const DEFAULTS: StoredState = {
    minimizeToTray: true
};

/** Persistência simples em JSON dentro do diretório `userData` do sistema. */
class SettingsStore {
    private state: StoredState | null = null;

    private get filePath(): string {
        return path.join(app.getPath('userData'), 'settings.json');
    }

    private load(): StoredState {
        if (!this.state) {
            try {
                this.state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) };
            } catch {
                this.state = { ...DEFAULTS };
            }
        }

        return this.state!;
    }

    private save(): void {
        const tmp = `${this.filePath}.tmp`;

        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
        fs.renameSync(tmp, this.filePath);
    }

    getPublic(): OttoSettings {
        const { minimizeToTray } = this.load();

        return { minimizeToTray };
    }

    setPublic(patch: Partial<OttoSettings>): OttoSettings {
        const state = this.load();

        if (typeof patch.minimizeToTray === 'boolean') {
            state.minimizeToTray = patch.minimizeToTray;
        }

        this.save();

        return this.getPublic();
    }

    get windowBounds(): Rectangle | undefined {
        return this.load().windowBounds;
    }

    set windowBounds(bounds: Rectangle | undefined) {
        this.load().windowBounds = bounds;
        this.save();
    }
}

export const settings = new SettingsStore();
