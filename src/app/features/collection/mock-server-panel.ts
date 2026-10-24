import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { DEFAULT_MOCK_PORT, type EntityId } from '@shared/models';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';
import { ipcErrorMessage } from '../../core/bridge/ipc-error';
import { MockState } from '../../core/state/mock.state';

const PORT_KEY = 'otto.mock.port.';

function savedPort(collectionId: EntityId): number {
    try {
        const port = Number(localStorage.getItem(PORT_KEY + collectionId));

        return Number.isInteger(port) && port >= 1024 && port <= 65_535 ? port : DEFAULT_MOCK_PORT;
    } catch {
        return DEFAULT_MOCK_PORT;
    }
}

/** Mock server local da coleção: iniciar/parar, endereço e últimas chamadas recebidas. */
@Component({
    selector: 'app-mock-server-panel',
    imports: [ButtonModule, InputTextModule, MessageModule, TooltipModule],
    template: `
        <div class="grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div class="flex min-w-0 flex-col gap-6">
                <!-- Controle do servidor -->
                <section class="flex flex-col gap-4 rounded-lg border border-surface-200 p-4 dark:border-surface-700" aria-labelledby="mock-server-heading">
                    <div class="flex flex-wrap items-center gap-3">
                        <h3 id="mock-server-heading" class="m-0 text-base font-semibold">Local mock server</h3>
                        @if (server()) {
                            <span class="flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300" role="status"
                                ><i class="pi pi-circle-fill text-[0.5rem]" aria-hidden="true"></i>Running</span
                            >
                        } @else {
                            <span class="flex items-center gap-1.5 rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium text-muted-color dark:bg-surface-800" role="status"
                                ><i class="pi pi-circle text-[0.5rem]" aria-hidden="true"></i>Stopped</span
                            >
                        }
                    </div>

                    @if (server(); as running) {
                        <div class="flex flex-wrap items-center gap-3">
                            <div class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-100 px-3 py-2 dark:bg-surface-800">
                                <span class="min-w-0 flex-1 truncate font-mono text-sm">{{ running.url }}</span>
                                <button type="button" class="otto-icon-button !h-6 !w-6" aria-label="Copy mock server URL" pTooltip="Copy URL" (click)="copy(running.url)">
                                    <i class="pi pi-copy text-xs" aria-hidden="true"></i>
                                </button>
                            </div>
                            <p-button label="Stop" icon="pi pi-stop-circle" severity="danger" [outlined]="true" [loading]="busy()" (onClick)="stop()" />
                        </div>
                        <dl class="m-0 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                            <div><dt class="text-xs text-muted-color">Port</dt><dd class="m-0 font-medium tabular-nums">{{ running.port }}</dd></div>
                            <div><dt class="text-xs text-muted-color">Routes served</dt><dd class="m-0 font-medium tabular-nums">{{ running.routes }}</dd></div>
                            <div><dt class="text-xs text-muted-color">Calls received</dt><dd class="m-0 font-medium tabular-nums">{{ running.hits.length }}</dd></div>
                        </dl>
                        @if (!running.routes) {
                            <p-message severity="warn" size="small">No request of this collection has response examples yet, so every call answers 404. Add examples in a request's <em>Examples</em> tab.</p-message>
                        }
                    } @else {
                        <p class="m-0 text-sm text-muted-color">Serves the response examples of this collection's requests on <code>127.0.0.1</code>, only on this machine.</p>
                        <div class="flex flex-wrap items-end gap-3">
                            <div class="flex flex-col gap-1">
                                <label for="mock-port" class="text-sm font-medium">Port</label>
                                <input pInputText id="mock-port" type="number" min="1024" max="65535" class="w-32" aria-describedby="mock-port-help" [value]="port()" (input)="setPort($any($event.target).value)" />
                            </div>
                            <p-button label="Start mock server" icon="pi pi-play" [loading]="busy()" [disabled]="!validPort()" (onClick)="start()" />
                        </div>
                        <small id="mock-port-help" class="-mt-2 text-muted-color">Between 1024 and 65535.</small>
                    }

                    @if (error(); as message) {
                        <p-message severity="error" size="small"
                            ><span role="alert">{{ message }}</span></p-message
                        >
                    }
                </section>

                <!-- Chamadas recebidas -->
                @if (server(); as running) {
                    <section aria-labelledby="mock-hits-heading">
                        <h3 id="mock-hits-heading" class="m-0 mb-2 text-sm font-semibold">Recent calls</h3>
                        @if (running.hits.length) {
                            <div class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-700">
                                <table class="w-full min-w-[36rem] table-fixed border-collapse text-sm">
                                    <caption class="sr-only">
                                        Calls received by the mock server, most recent first
                                    </caption>
                                    <thead>
                                        <tr class="bg-surface-50 text-left text-xs text-muted-color dark:bg-surface-900">
                                            <th scope="col" class="w-24 px-3 py-2 font-medium">Time</th>
                                            <th scope="col" class="w-20 px-3 py-2 font-medium">Method</th>
                                            <th scope="col" class="px-3 py-2 font-medium">Path</th>
                                            <th scope="col" class="w-16 px-3 py-2 font-medium">Status</th>
                                            <th scope="col" class="w-1/3 px-3 py-2 font-medium">Answered by</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        @for (hit of running.hits; track $index) {
                                            <tr class="border-t border-surface-200 dark:border-surface-700">
                                                <td class="px-3 py-2 tabular-nums text-muted-color">{{ time(hit.at) }}</td>
                                                <td class="px-3 py-2 font-mono">{{ hit.method }}</td>
                                                <td class="truncate px-3 py-2 font-mono" [title]="hit.path">{{ hit.path }}</td>
                                                <td class="px-3 py-2 font-mono font-semibold tabular-nums" [class]="statusClass(hit.status)">{{ hit.status }}</td>
                                                <td class="truncate px-3 py-2">
                                                    @if (hit.requestPath) {
                                                        {{ hit.requestPath }} <span class="text-muted-color">· {{ hit.example }}</span>
                                                    } @else {
                                                        <span class="text-muted-color">No matching route</span>
                                                    }
                                                </td>
                                            </tr>
                                        }
                                    </tbody>
                                </table>
                            </div>
                        } @else {
                            <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-600">
                                <i class="pi pi-inbox text-2xl text-muted-color" aria-hidden="true"></i>
                                <p class="m-0 text-sm text-muted-color">Waiting for calls. Point your app or try:</p>
                                <code class="rounded bg-surface-100 px-2 py-1 text-sm dark:bg-surface-800">curl {{ running.url }}/your/path</code>
                            </div>
                        }
                    </section>
                }
            </div>

            <!-- Guia -->
            <aside class="flex flex-col gap-5 text-sm" aria-label="How the mock server works">
                <section aria-labelledby="mock-steps-heading">
                    <h3 id="mock-steps-heading" class="m-0 mb-3 text-sm font-semibold">How it works</h3>
                    <ol class="m-0 flex list-none flex-col gap-3 p-0">
                        @for (step of steps; track $index) {
                            <li class="flex gap-3">
                                <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-contrast" aria-hidden="true">{{ $index + 1 }}</span>
                                <span><strong class="block">{{ step.title }}</strong><span class="text-muted-color">{{ step.text }}</span></span>
                            </li>
                        }
                    </ol>
                </section>

                <section aria-labelledby="mock-routes-heading">
                    <h3 id="mock-routes-heading" class="m-0 mb-2 text-sm font-semibold">Routes</h3>
                    <p class="m-0 text-muted-color">
                        Method + URL path of each request. Variables become parameters: <code>{{ pathExample }}</code> matches <code>/users/42</code>.
                    </p>
                </section>

                <section aria-labelledby="mock-dynamic-heading">
                    <h3 id="mock-dynamic-heading" class="m-0 mb-2 text-sm font-semibold">Dynamic responses</h3>
                    <dl class="m-0 flex flex-col gap-2">
                        <div>
                            <dt class="text-xs text-muted-color">From the call</dt>
                            <dd class="m-0 flex flex-wrap gap-1">
                                @for (item of fromCall; track item) {
                                    <code class="text-xs">{{ tpl(item) }}</code>
                                }
                            </dd>
                        </div>
                        <div>
                            <dt class="text-xs text-muted-color">Generated</dt>
                            <dd class="m-0 flex flex-wrap gap-1">
                                @for (item of generated; track item) {
                                    <code class="text-xs">{{ tpl(item) }}</code>
                                }
                            </dd>
                        </div>
                        <div>
                            <dt class="text-xs text-muted-color">Pick an example</dt>
                            <dd class="m-0"><code class="text-xs">X-Otto-Example: name</code> or <code class="text-xs">?__example=name</code></dd>
                        </div>
                    </dl>
                </section>

                <p class="m-0 text-xs text-muted-color">CORS is open to any origin. Changes saved on disk are picked up automatically.</p>
            </aside>
        </div>
    `
})
export class MockServerPanel {
    readonly collectionId = input.required<EntityId>();

    private readonly mocks = inject(MockState);
    private readonly messages = inject(MessageService);

    protected readonly steps = [
        { title: 'Add examples', text: "In a request's Examples tab, or with Save as example on a response." },
        { title: 'Start the server', text: 'Pick a free port and start it here.' },
        { title: 'Call it', text: 'Use the server URL as base URL in your app or in an environment.' }
    ];
    protected readonly fromCall = ['$params.id', '$query.page', '$header.authorization', '$body.user.name'];
    protected readonly generated = ['$uuid', '$now', '$timestamp', '$randomInt'];
    protected readonly pathExample = '{{$.baseUrl}}/users/{{$.id}}';
    protected readonly server = computed(() => this.mocks.find(this.collectionId()));
    protected readonly port = linkedSignal(() => this.server()?.port ?? savedPort(this.collectionId()));
    protected readonly validPort = computed(() => Number.isInteger(this.port()) && this.port() >= 1024 && this.port() <= 65_535);
    protected readonly busy = signal(false);
    protected readonly error = signal<string | null>(null);

    protected statusClass(status: number): string {
        if (status < 300) {
            return 'text-green-700 dark:text-green-400';
        }

        return status < 500 ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400';
    }

    protected tpl(expression: string): string {
        return `{{${expression}}}`;
    }

    protected time(iso: string): string {
        return new Date(iso).toLocaleTimeString();
    }

    protected setPort(value: string): void {
        this.port.set(Number(value));
    }

    protected async start(): Promise<void> {
        this.busy.set(true);
        this.error.set(null);

        try {
            await this.mocks.start(this.collectionId(), this.port());

            try {
                localStorage.setItem(PORT_KEY + this.collectionId(), String(this.port()));
            } catch {
                // Sem localStorage: só não lembra a porta.
            }
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected async stop(): Promise<void> {
        this.busy.set(true);

        try {
            await this.mocks.stop(this.collectionId());
        } catch (error) {
            this.error.set(ipcErrorMessage(error));
        } finally {
            this.busy.set(false);
        }
    }

    protected copy(text: string): void {
        void navigator.clipboard.writeText(text).then(() => this.messages.add({ severity: 'success', summary: 'Copied', life: 2000 }));
    }
}
