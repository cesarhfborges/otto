import { computed, inject, Injectable, signal } from '@angular/core';
import type { EntityId, RequestDefinition, TabState } from '@shared/models';
import { CollectionFilesGateway } from '../ports';
import { ConfirmState } from './confirm.state';
import { TabsState } from './tabs.state';

interface DraftEntry {
    /** Última versão lida/gravada no disco. */
    saved: RequestDefinition;
    /** Versão em edição (pode ser igual à salva). */
    draft: RequestDefinition;
}

export const draftKey = (collectionId: EntityId, path: string): string => `${collectionId}:${path}`;

const same = (a: RequestDefinition, b: RequestDefinition): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Rascunhos das requisições abertas. Ficam fora do componente para sobreviverem à
 * troca de abas; gravar (Ctrl+S) escreve o arquivo da coleção. Fechar uma aba com
 * alterações pede confirmação.
 */
@Injectable({ providedIn: 'root' })
export class RequestDraftsState {
    private readonly files = inject(CollectionFilesGateway);
    private readonly confirm = inject(ConfirmState);
    private readonly tabs = inject(TabsState);
    private readonly entries = signal<ReadonlyMap<string, DraftEntry>>(new Map());

    /** Chaves (`coleção:arquivo`) com alterações não salvas. */
    readonly dirtyKeys = computed(() => new Set([...this.entries()].filter(([, entry]) => !same(entry.saved, entry.draft)).map(([key]) => key)));
    readonly anyDirty = computed(() => this.dirtyKeys().size > 0);

    constructor() {
        this.tabs.setCloseGuard((tab) => this.confirmClose(tab));
    }

    draft(key: string): RequestDefinition | null {
        return this.entries().get(key)?.draft ?? null;
    }

    isDirty(key: string): boolean {
        return this.dirtyKeys().has(key);
    }

    /**
     * Conteúdo lido do disco (abertura ou mudança externa). Sem alterações locais o
     * rascunho acompanha o disco; com alterações, elas são mantidas.
     */
    loaded(key: string, fromDisk: RequestDefinition): void {
        const current = this.entries().get(key);
        const dirty = current && !same(current.saved, current.draft);

        this.set(key, { saved: fromDisk, draft: dirty ? current.draft : fromDisk });
    }

    update(key: string, change: (draft: RequestDefinition) => RequestDefinition): void {
        const current = this.entries().get(key);

        if (current) {
            this.set(key, { ...current, draft: change(current.draft) });
        }
    }

    async save(collectionId: EntityId, path: string): Promise<void> {
        const key = draftKey(collectionId, path);
        const current = this.entries().get(key);

        if (!current || same(current.saved, current.draft)) {
            return;
        }

        const draft = current.draft;

        await this.files.saveRequest(collectionId, path, draft);
        // Edições feitas durante a gravação continuam pendentes.
        this.set(key, { saved: draft, draft: this.entries().get(key)?.draft ?? draft });
    }

    /** Salva a requisição da aba indicada (atalho Ctrl+S / menu File → Save). */
    async saveTab(tab: TabState | null): Promise<void> {
        if (tab?.kind === 'request' && tab.collectionId && tab.resourceRef) {
            await this.save(tab.collectionId, tab.resourceRef);
        }
    }

    /** Salva todas as requisições com alterações; falhas são reunidas num único erro no fim. */
    async saveAll(): Promise<void> {
        const failures: string[] = [];

        for (const key of this.dirtyKeys()) {
            const separator = key.indexOf(':');
            const path = key.slice(separator + 1);

            try {
                await this.save(key.slice(0, separator), path);
            } catch (error) {
                failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (failures.length) {
            throw new Error(failures.join('\n'));
        }
    }

    /** Aplica uma mudança já gravada no disco (ex.: nova ordem) à versão salva e ao rascunho. */
    patch(key: string, change: (request: RequestDefinition) => RequestDefinition): void {
        const current = this.entries().get(key);

        if (current) {
            this.set(key, { saved: change(current.saved), draft: change(current.draft) });
        }
    }

    /** Acompanha um arquivo ou pasta movido: os rascunhos passam para os novos caminhos. */
    relocate(collectionId: EntityId, from: string, to: string): void {
        const prefix = draftKey(collectionId, from);

        this.entries.update((map) => new Map([...map].map(([key, entry]) => [key === prefix || key.startsWith(`${prefix}/`) ? draftKey(collectionId, to) + key.slice(prefix.length) : key, entry])));
    }

    discard(key: string): void {
        const current = this.entries().get(key);

        if (current) {
            this.set(key, { ...current, draft: current.saved });
        }
    }

    private async confirmClose(tab: TabState): Promise<boolean> {
        if (tab.kind !== 'request' || !tab.collectionId || !tab.resourceRef) {
            return true;
        }

        const key = draftKey(tab.collectionId, tab.resourceRef);

        if (this.isDirty(key)) {
            const discard = await this.confirm.ask({ header: 'Unsaved Changes', message: `"${tab.title}" has unsaved changes. Close it and discard them?`, acceptLabel: 'Discard and Close', severity: 'danger' });

            if (!discard) {
                return false;
            }
        }

        this.entries.update((map) => {
            const next = new Map(map);

            next.delete(key);

            return next;
        });

        return true;
    }

    private set(key: string, entry: DraftEntry): void {
        this.entries.update((map) => new Map(map).set(key, entry));
    }
}
