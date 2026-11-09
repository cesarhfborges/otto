import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { CollectionMetadata, CollectionScript, EntityId, ScriptInventory, ScriptPolicyPatch } from '../../../shared/models';
import type { IClock, ICollectionMetadataRepository, ITrustedScriptsRepository } from '../../core/contracts';
import type { CollectionService } from './collection.service';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const keyOf = (script: Pick<CollectionScript, 'location' | 'path' | 'phase'>): string => `${script.location}:${script.path}:${script.phase}`;

/** Impressão digital do conjunto: muda se qualquer script for alterado, criado, removido ou movido. */
const fingerprintOf = (scripts: readonly CollectionScript[]): string => sha256(JSON.stringify(scripts.map((script) => [keyOf(script), sha256(script.code)]).sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0))));

/**
 * Política de segurança dos scripts de cada coleção. A confiança fica presa ao conteúdo:
 * ao confiar, o main calcula a impressão digital e guarda o snapshot dos scripts (o
 * renderer nunca informa o fingerprint, então não consegue "confiar" em outro conteúdo).
 */
export class ScriptPolicyService {
    /** Edições do app em série por coleção (o antes/depois de uma não se mistura com outra). */
    private readonly edits = new Map<EntityId, Promise<void>>();

    constructor(
        private readonly collections: CollectionService,
        private readonly metadata: ICollectionMetadataRepository,
        private readonly trusted: ITrustedScriptsRepository,
        private readonly clock: IClock
    ) {}

    async inventory(id: EntityId): Promise<ScriptInventory> {
        const { scripts, names } = await this.collections.scripts(id);
        const fingerprint = fingerprintOf(scripts);
        let current = this.require(id);

        // Confiável sem impressão digital (criada pelo app, ou confiada antes da migração 007):
        // adota os scripts atuais uma vez, para não perguntar de novo a quem já confiou.
        if (current.scriptPolicy.mode === 'trusted' && !current.scriptPolicy.trustedFingerprint) {
            current = this.saveTrust(id, current, scripts, fingerprint);
        }

        const policy = current.scriptPolicy;
        const snapshot = policy.mode === 'trusted' ? this.trusted.list(id) : [];
        const trustedHashes = new Map(snapshot.map((script) => [keyOf(script), sha256(script.code)]));
        const currentKeys = new Set(scripts.map(keyOf));

        return {
            fingerprint,
            policy,
            entries: scripts.map((script) => {
                const hash = sha256(script.code);
                const before = trustedHashes.get(keyOf(script));

                return {
                    location: script.location,
                    path: script.path,
                    name: names.get(`${script.location}:${script.path}`) ?? (path.posix.basename(script.path) || 'Collection'),
                    phase: script.phase,
                    hash,
                    size: Buffer.byteLength(script.code, 'utf8'),
                    lines: script.code.split('\n').length,
                    trust: policy.mode !== 'trusted' ? 'same' : before === undefined ? 'new' : before === hash ? 'same' : 'changed'
                };
            }),
            removed: snapshot
                .filter((script) => !currentKeys.has(keyOf(script)))
                .map((script) => ({ location: script.location, path: script.path, phase: script.phase, name: script.location === 'collection' ? 'Collection' : path.posix.basename(script.path).replace(/\.ya?ml$/, '') }))
        };
    }

    /** Snapshot dos scripts confiados (para o diff). */
    trustedScripts(id: EntityId): CollectionScript[] {
        this.require(id);

        return this.trusted.list(id);
    }

    /** Conteúdo atual de todos os scripts (para o diff). */
    async currentScripts(id: EntityId): Promise<CollectionScript[]> {
        return (await this.collections.scripts(id)).scripts;
    }

    async setPolicy(id: EntityId, patch: ScriptPolicyPatch): Promise<CollectionMetadata> {
        const current = this.require(id);
        const policy = { mode: patch.mode, permissions: patch.permissions };

        if (patch.mode !== 'trusted') {
            // Sem confiança: o snapshot é descartado (confiar de novo exige revisar o conteúdo atual).
            this.trusted.replace(id, []);

            return this.metadata.setScriptPolicy(id, { ...policy, trustedFingerprint: null, trustedAt: null })!;
        }

        if (current.scriptPolicy.mode === 'trusted' && current.scriptPolicy.trustedFingerprint && !patch.retrust) {
            // Só as permissões mudaram: a confiança continua presa aos mesmos scripts.
            return this.metadata.setScriptPolicy(id, { ...policy, trustedFingerprint: current.scriptPolicy.trustedFingerprint, trustedAt: current.scriptPolicy.trustedAt })!;
        }

        const { scripts } = await this.collections.scripts(id);

        this.metadata.setScriptPolicy(id, { ...policy, trustedFingerprint: null, trustedAt: null });

        return this.saveTrust(id, this.require(id), scripts, fingerprintOf(scripts));
    }

    /**
     * Operação feita pelo próprio app (editor de scripts, renomear, mover, duplicar, apagar):
     * numa coleção confiável, o que o usuário fez aqui continua confiável. Adota no snapshot
     * (a) os scripts de `edited` que a operação alterou ou criou, (b) scripts novos idênticos a
     * um que já era confiável e estava igual (rename/move/duplicate), e tira os confiáveis que
     * a operação apagou. Mudanças externas (Git, outro editor, sync do OpenAPI) não passam por
     * aqui e continuam pedindo revisão.
     */
    async withAppEdit<T>(id: EntityId, op: () => Promise<T>, edited: (script: CollectionScript, result: T) => boolean = () => false): Promise<T> {
        const previous = this.edits.get(id) ?? Promise.resolve();
        const run = previous.then(async () => {
            const policy = this.metadata.findById(id)?.scriptPolicy;

            if (policy?.mode !== 'trusted' || !policy.trustedFingerprint) {
                return op();
            }

            const before = (await this.collections.scripts(id)).scripts;
            const result = await op();

            this.adopt(id, before, (await this.collections.scripts(id)).scripts, (script) => edited(script, result));

            return result;
        });

        this.edits.set(
            id,
            run.then(
                () => undefined,
                () => undefined
            )
        );

        return run;
    }

    private adopt(id: EntityId, before: readonly CollectionScript[], after: readonly CollectionScript[], edited: (script: CollectionScript) => boolean): void {
        const snapshot = new Map(this.trusted.list(id).map((script) => [keyOf(script), script]));
        const beforeHashes = new Map(before.map((script) => [keyOf(script), sha256(script.code)]));
        // Hashes que eram confiáveis e estavam iguais antes da operação.
        const trustedSame = new Set(before.filter((script) => snapshot.has(keyOf(script)) && sha256(snapshot.get(keyOf(script))!.code) === beforeHashes.get(keyOf(script))).map((script) => sha256(script.code)));
        const afterKeys = new Set(after.map(keyOf));
        let changed = false;

        for (const script of after) {
            const key = keyOf(script);
            const hash = sha256(script.code);
            const isNew = !beforeHashes.has(key);
            const touched = beforeHashes.get(key) !== hash;
            const trusted = snapshot.has(key) && sha256(snapshot.get(key)!.code) === hash;

            if (!trusted && ((touched && edited(script)) || (isNew && trustedSame.has(hash)))) {
                snapshot.set(key, script);
                changed = true;
            }
        }

        for (const script of before) {
            const key = keyOf(script);

            if (!afterKeys.has(key) && snapshot.delete(key)) {
                changed = true;
            }
        }

        if (!changed) {
            return;
        }

        const scripts = [...snapshot.values()];
        const current = this.require(id).scriptPolicy;

        this.trusted.replace(id, scripts);
        this.metadata.setScriptPolicy(id, { mode: 'trusted', permissions: current.customPermissions ? current.permissions : null, trustedFingerprint: fingerprintOf(scripts), trustedAt: current.trustedAt });
    }

    private saveTrust(id: EntityId, current: CollectionMetadata, scripts: readonly CollectionScript[], fingerprint: string): CollectionMetadata {
        this.trusted.replace(id, scripts);

        return this.metadata.setScriptPolicy(id, {
            mode: 'trusted',
            permissions: current.scriptPolicy.customPermissions ? current.scriptPolicy.permissions : null,
            trustedFingerprint: fingerprint,
            trustedAt: this.clock.now()
        })!;
    }

    private require(id: EntityId): CollectionMetadata {
        const metadata = this.metadata.findById(id);

        if (!metadata) {
            throw new Error('Collection not found');
        }

        return metadata;
    }
}
