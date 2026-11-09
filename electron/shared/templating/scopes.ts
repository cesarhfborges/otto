import type { VariableScope } from './ast';

export interface VariableItem {
    key: string;
    value: string;
    enabled: boolean;
    secret?: boolean;
}

export interface VariableLayer {
    scope: VariableScope;
    /** Rótulo mostrado no autocomplete/erros (`Dev`, `Collection`). */
    label: string;
    items: readonly VariableItem[];
}

export interface VariableEntry {
    name: string;
    value: string;
    secret: boolean;
    scope: VariableScope;
    label: string;
    /** Sobrescrita por uma camada mais específica. */
    shadowed: boolean;
}

/** Como scripts sem a permissão "Read secret variables" enxergam valores secretos. */
export const SECRET_MASK = '••••';

/** Cadeia de escopos (§4 do plano): a primeira camada com o nome vence. */
export class VariableScopes {
    constructor(readonly layers: readonly VariableLayer[]) {}

    /** Cópia com os valores secretos trocados por `SECRET_MASK`. */
    masked(): VariableScopes {
        return new VariableScopes(this.layers.map((layer) => ({ ...layer, items: layer.items.map((item) => (item.secret ? { ...item, value: SECRET_MASK } : item)) })));
    }

    lookup(name: string, scope: VariableScope | null = null): VariableEntry | undefined {
        return this.entries().find((entry) => entry.name === name && (scope ? entry.scope === scope : !entry.shadowed));
    }

    /** Todas as variáveis, na ordem de precedência, marcando as sobrescritas. */
    entries(): VariableEntry[] {
        const seen = new Set<string>();

        return this.layers.flatMap((layer) =>
            layer.items
                .filter((item) => item.enabled && item.key.trim())
                .map((item) => {
                    const name = item.key.trim();
                    const shadowed = seen.has(name);

                    seen.add(name);

                    return { name, value: item.value, secret: item.secret ?? false, scope: layer.scope, label: layer.label, shadowed };
                })
        );
    }

    /** Onde procurar quando não achou (para a mensagem de erro). */
    describe(): string {
        return this.layers.map((layer) => layer.label).join(', ') || 'no scope';
    }
}
