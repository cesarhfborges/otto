import { Component, computed, input } from '@angular/core';
import type { HttpResponse, HttpTimelineEntry } from '@shared/models';
import { type CookieInfo, parseCookieHeader, parseSetCookie } from '@shared/templating';

const SET_COOKIE = /^set-cookie:\s*/i;
const COOKIE = /^cookie:\s*/i;

/**
 * Cookies enviados pela requisição: o header `Cookie` de cada salto registrado no console (o que de fato
 * saiu, venha do cookie jar da coleção ou de um header digitado). O mesmo nome em mais de um salto fica com o último valor.
 */
export function requestCookies(timeline: readonly HttpTimelineEntry[]): Array<[string, string]> {
    const cookies = new Map<string, string>();

    for (const entry of timeline) {
        if (entry.kind === 'request-header' && COOKIE.test(entry.text)) {
            for (const [name, value] of parseCookieHeader(entry.text.replace(COOKIE, ''))) {
                cookies.delete(name);
                cookies.set(name, value);
            }
        }
    }

    return [...cookies];
}

/**
 * Cookies definidos pela resposta (`Set-Cookie`). Lê os headers recebidos de todos os saltos do
 * console (um login costuma definir o cookie num 302, que não aparece nos headers da resposta final);
 * sem console, os da resposta. O mesmo cookie (nome + domínio + caminho) em mais de um salto fica com o último.
 */
export function responseCookies(response: HttpResponse, timeline: readonly HttpTimelineEntry[]): CookieInfo[] {
    const fromTimeline = timeline.filter((entry) => entry.kind === 'response-header' && SET_COOKIE.test(entry.text)).map((entry) => entry.text.replace(SET_COOKIE, ''));
    const headers = fromTimeline.length ? fromTimeline : response.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value);
    const cookies = new Map<string, CookieInfo>();

    for (const header of headers) {
        const cookie = parseSetCookie(header);

        if (cookie) {
            const key = `${cookie.name}\n${cookie.domain ?? ''}\n${cookie.path ?? ''}`;

            // Reinsere para a ordem refletir a última definição.
            cookies.delete(key);
            cookies.set(key, cookie);
        }
    }

    return [...cookies.values()];
}

/**
 * Aba "Cookies" do painel de resposta, em duas partes: o que a requisição enviou (header `Cookie`; pode ser
 * ocultado nas preferências) e o que o servidor pediu para guardar (`Set-Cookie`), com os atributos de cada um.
 */
@Component({
    selector: 'app-response-cookies',
    template: `
        @if (showSent()) {
            <section aria-labelledby="response-cookies-sent" class="mb-6">
                <h2 id="response-cookies-sent" class="m-0 mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-color">
                    <i class="pi pi-arrow-up-right text-xs" aria-hidden="true"></i>
                    Sent <span class="font-normal">({{ sent().length }})</span>
                </h2>
                @if (sent().length) {
                    <table class="w-full table-fixed border-collapse text-sm">
                        <caption class="sr-only">
                            Cookies sent with the request
                        </caption>
                        <thead>
                            <tr class="text-left text-xs text-muted-color">
                                <th scope="col" class="w-[18%] border-b border-surface-200 py-1.5 pr-3 font-medium dark:border-surface-700">Name</th>
                                <th scope="col" class="border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (cookie of sent(); track $index) {
                                <tr>
                                    <td class="break-all border-b border-surface-100 py-1.5 pr-3 align-top font-mono dark:border-surface-800">{{ cookie[0] }}</td>
                                    <td class="break-all border-b border-surface-100 py-1.5 align-top font-mono dark:border-surface-800">{{ cookie[1] }}</td>
                                </tr>
                            }
                        </tbody>
                    </table>
                } @else {
                    <p class="m-0 py-2 text-sm text-muted-color">The request did not send any cookies.</p>
                }
            </section>
        }

        <section aria-labelledby="response-cookies-received">
            <h2 id="response-cookies-received" class="m-0 mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-color">
                <i class="pi pi-arrow-down-left text-xs" aria-hidden="true"></i>
                Received <span class="font-normal">({{ cookies().length }})</span>
            </h2>
            @if (cookies().length) {
                <table class="w-full table-fixed border-collapse text-sm">
                    <caption class="sr-only">
                        Cookies set by the response
                    </caption>
                    <thead>
                        <tr class="text-left text-xs text-muted-color">
                            <th scope="col" class="w-[18%] border-b border-surface-200 py-1.5 pr-3 font-medium dark:border-surface-700">Name</th>
                            <th scope="col" class="border-b border-surface-200 py-1.5 pr-3 font-medium dark:border-surface-700">Value</th>
                            <th scope="col" class="w-[16%] border-b border-surface-200 py-1.5 pr-3 font-medium dark:border-surface-700">Domain</th>
                            <th scope="col" class="w-[10%] border-b border-surface-200 py-1.5 pr-3 font-medium dark:border-surface-700">Path</th>
                            <th scope="col" class="w-[16%] border-b border-surface-200 py-1.5 pr-3 font-medium dark:border-surface-700">Expires</th>
                            <th scope="col" class="w-[18%] border-b border-surface-200 py-1.5 font-medium dark:border-surface-700">Attributes</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (cookie of cookies(); track $index) {
                            <tr>
                                <td class="break-all border-b border-surface-100 py-1.5 pr-3 align-top font-mono dark:border-surface-800">{{ cookie.name }}</td>
                                <td class="break-all border-b border-surface-100 py-1.5 pr-3 align-top font-mono dark:border-surface-800">{{ cookie.value }}</td>
                                <td class="break-all border-b border-surface-100 py-1.5 pr-3 align-top dark:border-surface-800">
                                    @if (cookie.domain) {
                                        {{ cookie.domain }}
                                    } @else {
                                        {{ host() }}
                                        <span class="block whitespace-nowrap text-xs text-muted-color">host only</span>
                                    }
                                </td>
                                <td class="break-all border-b border-surface-100 py-1.5 pr-3 align-top font-mono dark:border-surface-800">{{ cookie.path || '/' }}</td>
                                <td class="border-b border-surface-100 py-1.5 pr-3 align-top dark:border-surface-800">{{ expiry(cookie) }}</td>
                                <td class="border-b border-surface-100 py-1.5 align-top dark:border-surface-800">
                                    <span class="flex flex-wrap gap-1">
                                        @if (cookie.httpOnly) {
                                            <span class="otto-cookie-flag">HttpOnly</span>
                                        }
                                        @if (cookie.secure) {
                                            <span class="otto-cookie-flag">Secure</span>
                                        }
                                        @if (cookie.sameSite) {
                                            <span class="otto-cookie-flag">SameSite={{ cookie.sameSite }}</span>
                                        }
                                        @if (!cookie.httpOnly && !cookie.secure && !cookie.sameSite) {
                                            <span class="text-muted-color">—</span>
                                        }
                                    </span>
                                </td>
                            </tr>
                        }
                    </tbody>
                </table>
            } @else {
                <p class="m-0 py-2 text-sm text-muted-color">The response did not set any cookies.</p>
            }
        </section>
    `,
    styles: `
        .otto-cookie-flag {
            border-radius: 9999px;
            background: var(--p-content-hover-background);
            padding: 0.0625rem 0.5rem;
            font-size: 0.75rem;
            font-weight: 500;
            white-space: nowrap;
        }
    `
})
export class ResponseCookies {
    readonly response = input.required<HttpResponse>();
    readonly timeline = input<readonly HttpTimelineEntry[]>([]);
    /** Preferência "Show request cookies". */
    readonly showSent = input(true);

    protected readonly sent = computed(() => requestCookies(this.timeline()));
    protected readonly cookies = computed(() => responseCookies(this.response(), this.timeline()));
    /** Sem `Domain`, o cookie vale só para o host que respondeu (cookies ignoram a porta). */
    protected readonly host = computed(() => {
        try {
            return new URL(this.response().url).hostname;
        } catch {
            return '';
        }
    });

    /** `Max-Age` tem precedência sobre `Expires`; sem nenhum dos dois, é cookie de sessão. */
    protected expiry(cookie: CookieInfo): string {
        if (cookie.maxAge !== undefined && !Number.isNaN(cookie.maxAge)) {
            return cookie.maxAge <= 0 ? 'Deleted (Max-Age=0)' : `In ${formatSeconds(cookie.maxAge)} (Max-Age)`;
        }

        if (cookie.expires) {
            const date = new Date(cookie.expires);

            if (Number.isNaN(date.getTime())) {
                return cookie.expires;
            }

            // Data no passado é como o servidor apaga um cookie.
            return date.getTime() <= Date.now() ? 'Deleted (expired)' : date.toLocaleString();
        }

        return 'Session';
    }
}

function formatSeconds(seconds: number): string {
    const units: Array<[number, string]> = [
        [86_400, 'd'],
        [3_600, 'h'],
        [60, 'min']
    ];

    for (const [size, label] of units) {
        if (seconds >= size) {
            return `${Math.round(seconds / size)} ${label}`;
        }
    }

    return `${seconds} s`;
}
