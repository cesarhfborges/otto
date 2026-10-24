import type { CommandId, KeybindingOverrides } from '../../../shared/models';

/** Persistência dos atalhos personalizados (só as diferenças em relação ao padrão). */
export interface IKeybindingStore {
    get(): KeybindingOverrides;
    /** Substitui os overrides (já validados). */
    set(overrides: KeybindingOverrides): void;
}

/** Atalhos com notificação de mudanças (menu nativo e renderer). */
export interface IKeybindingService {
    get(): KeybindingOverrides;
    set(overrides: KeybindingOverrides): KeybindingOverrides;
    reset(id?: CommandId): KeybindingOverrides;
    /** Retorna a função para remover o listener. */
    onChange(listener: (overrides: KeybindingOverrides) => void): () => void;
}
