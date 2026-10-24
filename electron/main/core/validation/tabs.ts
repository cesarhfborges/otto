import { TAB_KINDS, type TabState } from '../../../shared/models';
import { optionalString, parseEntityId, parseNullableEntityId, requireArray, requireBoolean, requireInteger, requireOneOf, requireRecord, requireString, ValidationError } from './guards';

export const MAX_TABS = 200;
/** Rascunhos guardam o estado não salvo da aba (corpo da requisição etc.). */
export const MAX_DRAFT_LENGTH = 5_000_000;

export function parseTabs(raw: unknown): TabState[] {
    const tabs = requireArray(raw, 'tabs', MAX_TABS).map((item, i): TabState => {
        const tab = requireRecord(item, `tabs[${i}]`);

        return {
            id: parseEntityId(tab['id'], `tabs[${i}].id`),
            kind: requireOneOf(tab['kind'], TAB_KINDS, `tabs[${i}].kind`),
            title: requireString(tab['title'], `tabs[${i}].title`, { allowEmpty: true, maxLength: 500 }),
            collectionId: parseNullableEntityId(tab['collectionId'], `tabs[${i}].collectionId`),
            resourceRef: optionalString(tab['resourceRef'], `tabs[${i}].resourceRef`),
            position: requireInteger(tab['position'], `tabs[${i}].position`, 0),
            active: requireBoolean(tab['active'], `tabs[${i}].active`),
            draft: optionalString(tab['draft'], `tabs[${i}].draft`, { allowEmpty: true, maxLength: MAX_DRAFT_LENGTH })
        };
    });

    if (new Set(tabs.map((t) => t.id)).size !== tabs.length) {
        throw new ValidationError('tabs', 'ids must be unique');
    }

    if (tabs.filter((t) => t.active).length > 1) {
        throw new ValidationError('tabs', 'at most one tab can be active');
    }

    return tabs;
}
