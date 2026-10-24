import { DestroyRef, inject, Injectable } from '@angular/core';
import type { CommandId } from '@shared/models';
import { TAB_ACTIVE } from '../../shell/tab-active';

/** Estado do DOM no momento da tecla (o estado da aplicação é lido pelos próprios handlers). */
export interface CommandContext {
    /** Elemento focado. */
    readonly target: Element | null;
    /** Há um diálogo modal aberto (Preferences, confirmação, novo item...). */
    readonly modalOpen: boolean;
    /** Há um menu/lista suspensa aberta (select, menu de contexto...). */
    readonly overlayOpen: boolean;
    /** Foco num campo de texto. */
    readonly inputFocus: boolean;
    /** Formulário que contém o foco. */
    readonly form: HTMLFormElement | null;
}

export interface CommandHandler {
    /** Sem `when`, o comando está sempre habilitado. */
    when?(context: CommandContext): boolean;
    run(context: CommandContext): unknown;
}

/** De onde veio a execução: teclado (renderer) ou menu nativo/tray. */
export type CommandSource = 'keyboard' | 'menu';

/**
 * No macOS o menu nativo pode tratar a tecla além do renderer: o mesmo comando vindo
 * da outra origem dentro deste intervalo é a mesma tecla e é ignorado.
 */
const DUPLICATE_WINDOW_MS = 150;

/**
 * Handlers dos comandos. Telas registram os seus enquanto existem (`registerCommand`);
 * com mais de um handler para o mesmo comando vale o último registrado que estiver habilitado
 * (ex.: várias abas de requisição vivas, só a ativa responde).
 */
@Injectable({ providedIn: 'root' })
export class CommandRegistry {
    private readonly handlers = new Map<CommandId, CommandHandler[]>();
    private readonly lastRun = new Map<CommandId, { at: number; source: CommandSource }>();

    register(id: CommandId, handler: CommandHandler): () => void {
        this.handlers.set(id, [...(this.handlers.get(id) ?? []), handler]);

        return () => this.handlers.set(id, (this.handlers.get(id) ?? []).filter((h) => h !== handler));
    }

    isEnabled(id: CommandId, context: CommandContext): boolean {
        return !!this.enabledHandler(id, context);
    }

    /** Executa se houver handler habilitado; `false` = nada a fazer (a tecla segue seu curso). */
    execute(id: CommandId, context: CommandContext, source: CommandSource = 'keyboard'): boolean {
        const handler = this.enabledHandler(id, context);

        if (!handler) {
            return false;
        }

        const now = Date.now();
        const last = this.lastRun.get(id);

        if (last && last.source !== source && now - last.at < DUPLICATE_WINDOW_MS) {
            return true;
        }

        this.lastRun.set(id, { at: now, source });
        void Promise.resolve()
            .then(() => handler.run(context))
            .catch((error: unknown) => console.error(`[otto] command "${id}" failed`, error));

        return true;
    }

    private enabledHandler(id: CommandId, context: CommandContext): CommandHandler | undefined {
        const handlers = this.handlers.get(id) ?? [];

        for (let i = handlers.length - 1; i >= 0; i--) {
            const handler = handlers[i]!;

            if (handler.when?.(context) ?? true) {
                return handler;
            }
        }

        return undefined;
    }
}

/**
 * Registra o handler enquanto o componente/serviço atual existir. Chamar num contexto de injeção.
 * Dentro de uma aba, o comando só fica habilitado enquanto ela for a ativa.
 */
export function registerCommand(id: CommandId, handler: CommandHandler): void {
    const active = inject(TAB_ACTIVE, { optional: true });
    const scoped: CommandHandler = active ? { run: (context) => handler.run(context), when: (context) => active() && (handler.when?.(context) ?? true) } : handler;

    inject(DestroyRef).onDestroy(inject(CommandRegistry).register(id, scoped));
}
