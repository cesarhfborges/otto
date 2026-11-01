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
