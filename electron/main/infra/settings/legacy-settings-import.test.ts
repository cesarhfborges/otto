import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { DEFAULT_SETTINGS } from '../../../shared/models';
import { fakeClock, migratedMemoryDb } from '../../testing/fixtures';
import { SqliteSettingsStore } from '../repositories/sqlite-settings.store';
import { importLegacySettings } from './legacy-settings-import';

describe('importLegacySettings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otto-legacy-'));

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('não faz nada quando o arquivo não existe', () => {
        const store = new SqliteSettingsStore(migratedMemoryDb(), fakeClock());

        assert.equal(importLegacySettings(path.join(dir, 'missing.json'), store), false);
    });

    it('importa preferências e janela e renomeia o arquivo', () => {
        const file = path.join(dir, 'settings.json');
        const store = new SqliteSettingsStore(migratedMemoryDb(), fakeClock());

        fs.writeFileSync(file, JSON.stringify({ minimizeToTray: false, windowBounds: { x: 1, y: 2, width: 3, height: 4 } }));

        assert.equal(importLegacySettings(file, store), true);
        assert.deepEqual(store.get(), { ...DEFAULT_SETTINGS, minimizeToTray: false });
        assert.deepEqual(store.getBounds(), { x: 1, y: 2, width: 3, height: 4 });
        assert.equal(fs.existsSync(file), false);
        assert.equal(fs.existsSync(`${file}.migrated`), true);
        assert.equal(importLegacySettings(file, store), false);
    });

    it('descarta um arquivo corrompido sem quebrar', () => {
        const file = path.join(dir, 'corrupt.json');
        const store = new SqliteSettingsStore(migratedMemoryDb(), fakeClock());

        fs.writeFileSync(file, '{not json');

        assert.equal(importLegacySettings(file, store), true);
        assert.deepEqual(store.get(), DEFAULT_SETTINGS);
    });
});
