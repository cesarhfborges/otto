import type { EntityId } from '@shared/models';
import { jsonPaths, parseSetCookie, requestSnapshot, type MessageSnapshot, type MessageTarget, type VariableScopes } from '@shared/templating';
import { draftKey, type RequestDraftsState } from '@/app/core/state/request-drafts.state';
import type { ResponsesState } from '@/app/core/state/responses.state';
import type { TemplateContextService } from '@/app/core/templating/template-context.service';
import type { MessageSuggestions, TemplateCompletionData } from './template-completions';

const unique = (items: string[]): string[] => [...new Set(items)];

export function suggestionsOf(snapshot: MessageSnapshot, title: string): MessageSuggestions {
    let body: unknown;

    try {
        body = JSON.parse(snapshot.bodyEncoding === 'utf8' ? snapshot.body : '');
    } catch {
        body = undefined;
    }

    const names = (pairs: Array<[string, string]> = []): string[] => unique(pairs.map(([name]) => name));
    const cookies =
        snapshot.kind === 'response'
            ? snapshot.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').flatMap(([, value]) => parseSetCookie(value)?.name ?? [])
            : (snapshot.headers.find(([name]) => name.toLowerCase() === 'cookie')?.[1] ?? '').split(';').flatMap((part) => part.split('=')[0]?.trim() || []);

    return { title, paths: body === undefined ? [] : jsonPaths(body), headers: names(snapshot.headers), cookies: unique(cookies), params: names(snapshot.params), forms: names(snapshot.forms) };
}


/**
 * Dados do autocomplete (templates e scripts): variáveis do escopo, requisições da
 * coleção e o conteúdo da requisição/última resposta usado em `paths`, `headers`…
 */
export function templateCompletionData(
    deps: { templates: TemplateContextService; responses: ResponsesState; drafts: RequestDraftsState },
    collectionId: EntityId | null,
    scopes: VariableScopes,
    requestPath: string | null
): TemplateCompletionData {
    const { templates, responses, drafts } = deps;

    return {
        variables: () => scopes.entries(),
        requests: () => templates.requests(collectionId),
        message: (target: MessageTarget) => {
            if (!collectionId) {
                return null;
            }

            const entry = target.ref ? templates.findRequest(collectionId, target.ref) : null;
            const path = target.ref ? entry?.path : requestPath;

            if (!path) {
                return null;
            }

            if (target.kind === 'response') {
                const snapshot = responses.lastResponse(collectionId, path);

                return snapshot ? suggestionsOf(snapshot, `${entry?.name ?? path} · ${snapshot.status} · last response`) : null;
            }

            const definition = drafts.draft(draftKey(collectionId, path));

            return definition ? suggestionsOf(requestSnapshot(definition), entry?.name ?? 'This request') : null;
        }
    };
}
