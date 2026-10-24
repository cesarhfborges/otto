import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OttoSettings } from '../../../shared/models';
import { SqliteSettingsStore } from '../../infra/repositories/sqlite-settings.store';
import { fakeClock, migratedMemoryDb } from '../../testing/fixtures';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
    it('notifica apenas quando algo muda de fato', () => {
        const service = new SettingsService(new SqliteSettingsStore(migratedMemoryDb(), fakeClock()));
        const received: OttoSettings[] = [];
        const unsubscribe = service.onChange((s) => received.push(s));

        service.update({ theme: 'dark' });
        service.update({ theme: 'dark' });
        service.update({ http: { timeoutMs: 1_000 } });
        unsubscribe();
        service.update({ theme: 'light' });

        assert.deepEqual(
            received.map((s) => [s.theme, s.http.timeoutMs]),
            [
                ['dark', 30_000],
                ['dark', 1_000]
            ]
        );
    });

    it('devolve cópias, protegendo o cache contra mutação', () => {
        const service = new SettingsService(new SqliteSettingsStore(migratedMemoryDb(), fakeClock()));

        service.get().http.proxy.enabled = true;

        assert.equal(service.get().http.proxy.enabled, false);
    });
});
