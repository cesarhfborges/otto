import { Component, computed, input } from '@angular/core';
import type { KeyValue, RequestAuth, RequestBody, RequestDefinition } from '@shared/models';

type Mark = 'same' | 'added' | 'removed' | 'modified';

interface Row {
    field: string;
    value: string;
    mark: Mark;
}

interface Section {
    title: string;
    left: Row[] | null;
    right: Row[] | null;
}

const AUTH_LABELS: Record<RequestAuth['type'], string> = { none: 'No Auth', inherit: 'Inherit', basic: 'Basic Auth', bearer: 'Bearer Token', apikey: 'API Key', wsse: 'WSSE' };
const BODY_LABELS: Record<RequestBody['type'], string> = { none: 'No Body', json: 'JSON', text: 'Text', xml: 'XML', 'form-urlencoded': 'Form URL Encoded', 'multipart-form': 'Multipart Form', binary: 'File / Binary' };

const pairs = (items: KeyValue[]): Array<[string, string]> => items.map((item) => [item.key, item.enabled ? item.value : `${item.value} (disabled)`]);

/** Campos comparáveis de cada seção, como pares nome → valor. */
function fields(request: RequestDefinition): Record<string, Array<[string, string]>> {
    const { auth, body } = request;
    const authFields: Array<[string, string]> = [['Auth Mode', AUTH_LABELS[auth.type]]];

    switch (auth.type) {
        case 'bearer':
            authFields.push(['Prefix', auth.prefix ?? ''], ['Token', auth.token]);
            break;
        case 'basic':
        case 'wsse':
            authFields.push(['Username', auth.username], ['Password', auth.password ? '••••' : '']);
            break;
        case 'apikey':
            authFields.push(['Key', auth.key], ['Value', auth.value], ['Add to', auth.in]);
            break;
    }

    const bodyFields: Array<[string, string]> = [['Type', BODY_LABELS[body.type]]];

    if ('content' in body) {
        bodyFields.push(['Content', body.content]);
    } else if (body.type === 'form-urlencoded' || body.type === 'multipart-form') {
        bodyFields.push(...pairs(body.fields));
    } else if (body.type === 'binary') {
        bodyFields.push(['File', body.file]);
    }

    return {
        URL: [
            ['Method', request.method],
            ['URL', request.url]
        ],
        Params: pairs(request.params),
        Headers: pairs(request.headers),
        Body: bodyFields,
        Authentication: authFields
    };
}

function mark(own: Array<[string, string]>, other: Array<[string, string]> | null, missing: Mark): Row[] {
    const otherMap = new Map(other ?? []);

    return own.map(([field, value]) => ({ field, value, mark: !other ? missing : !otherMap.has(field) ? missing : otherMap.get(field) === value ? 'same' : 'modified' }));
}

/**
 * Diff lado a lado de um endpoint: só as seções com diferenças. Marcas: A (adicionado),
 * D (removido), M (modificado). Um lado ausente aparece como "No content".
 */
@Component({
    selector: 'app-endpoint-diff',
    template: `
        <div class="overflow-hidden rounded-md border border-surface-200 dark:border-surface-700">
            <div class="grid grid-cols-2 border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-muted-color dark:border-surface-700 dark:bg-surface-900">
                <div class="px-3 py-2">{{ leftLabel() }}</div>
                <div class="border-l border-surface-200 px-3 py-2 dark:border-surface-700">{{ rightLabel() }}</div>
            </div>
            @for (section of sections(); track section.title) {
                <details open class="border-b border-surface-200 last:border-b-0 dark:border-surface-700">
                    <summary class="cursor-pointer px-3 py-2 text-sm font-medium">{{ section.title }}</summary>
                    <div class="grid grid-cols-2 gap-3 px-3 pb-3">
                        @for (side of [section.left, section.right]; track $index) {
                            @if (side) {
                                <table class="w-full table-fixed border-collapse self-start overflow-hidden rounded border border-surface-200 text-xs dark:border-surface-700">
                                    <caption class="sr-only">
                                        {{
                                            section.title + ($index === 0 ? ' — ' + leftLabel() : ' — ' + rightLabel())
                                        }}
                                    </caption>
                                    <thead>
                                        <tr class="text-left text-muted-color">
                                            <th scope="col" class="w-7 px-2 py-1.5"><span class="sr-only">Change</span></th>
                                            <th scope="col" class="w-2/5 px-2 py-1.5 font-medium">Field</th>
                                            <th scope="col" class="px-2 py-1.5 font-medium">Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        @for (row of side; track $index) {
                                            <tr [class]="rowClass(row.mark)">
                                                <td class="px-2 py-1.5 align-top">
                                                    @if (row.mark !== 'same') {
                                                        <span class="inline-block rounded px-1 font-mono text-[0.625rem] font-bold" [class]="badgeClass(row.mark)" [attr.aria-label]="markLabel(row.mark)">{{ markLetter(row.mark) }}</span>
                                                    }
                                                </td>
                                                <td class="break-all px-2 py-1.5 align-top font-mono">{{ row.field || '(empty name)' }}</td>
                                                <td class="whitespace-pre-wrap break-all px-2 py-1.5 align-top font-mono">{{ row.value || '—' }}</td>
                                            </tr>
                                        }
                                    </tbody>
                                </table>
                            } @else {
                                <div class="flex min-h-16 items-center justify-center rounded border border-dashed border-surface-300 text-xs text-muted-color dark:border-surface-600">No content</div>
                            }
                        }
                    </div>
                </details>
            } @empty {
                <p class="m-0 px-3 py-3 text-sm text-muted-color">No differences in parameters, headers, body or auth.</p>
            }
        </div>
    `,
    host: { class: 'block' }
})
export class EndpointDiff {
    readonly before = input.required<RequestDefinition | null>();
    readonly after = input.required<RequestDefinition | null>();
    readonly leftLabel = input('Before');
    readonly rightLabel = input('After');

    protected readonly sections = computed<Section[]>(() => {
        const before = this.before();
        const after = this.after();
        const left = before ? fields(before) : null;
        const right = after ? fields(after) : null;

        return ['URL', 'Params', 'Headers', 'Body', 'Authentication']
            .map(
                (title): Section => ({
                    title,
                    left: left && (left[title]!.length || !right) ? mark(left[title]!, right?.[title] ?? null, 'removed') : null,
                    right: right && (right[title]!.length || !left) ? mark(right[title]!, left?.[title] ?? null, 'added') : null
                })
            )
            .filter((section) => [...(section.left ?? []), ...(section.right ?? [])].some((row) => row.mark !== 'same'));
    });

    protected markLetter(mark: Mark): string {
        return { added: 'A', removed: 'D', modified: 'M', same: '' }[mark];
    }

    protected markLabel(mark: Mark): string {
        return { added: 'Added', removed: 'Removed', modified: 'Modified', same: '' }[mark];
    }

    protected badgeClass(mark: Mark): string {
        return {
            added: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
            removed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
            modified: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
            same: ''
        }[mark];
    }

    protected rowClass(mark: Mark): string {
        return { added: 'bg-green-50 dark:bg-green-950/40', removed: 'bg-red-50 dark:bg-red-950/40', modified: 'bg-amber-50 dark:bg-amber-950/40', same: '' }[mark];
    }
}
