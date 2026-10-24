import * as fs from 'node:fs';
import type { ICollectionWatcher } from '../../core/contracts';

const DEBOUNCE_MS = 250;

/** Ignora mudanças em entradas ocultas (`.git`) e nos temporários da escrita atômica. */
const isRelevant = (fileName: string | null): boolean => !fileName || !(fileName.split(/[\\/]/).some((segment) => segment.startsWith('.')) || fileName.endsWith('.tmp'));

/** `fs.watch` recursivo (suportado no Linux a partir do Node 20) com debounce. */
export class FsCollectionWatcher implements ICollectionWatcher {
    watch(root: string, onChange: () => void): () => void {
        let timer: NodeJS.Timeout | undefined;
        let watcher: fs.FSWatcher;

        try {
            watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, fileName) => {
                if (isRelevant(fileName === null ? null : String(fileName))) {
                    clearTimeout(timer);
                    timer = setTimeout(onChange, DEBOUNCE_MS);
                }
            });
        } catch (error) {
            console.warn(`[otto] cannot watch "${root}":`, error);

            return () => undefined;
        }

        // A pasta pode ser removida/desmontada: paramos de observar sem derrubar o app.
        watcher.on('error', () => watcher.close());

        return () => {
            clearTimeout(timer);
            watcher.close();
        };
    }
}
