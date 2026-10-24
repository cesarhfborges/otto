import type { TabKind } from '@shared/models';

/** Ícone PrimeIcons de cada tipo de aba (requisições usam o badge de método). */
export const TAB_ICONS: Record<TabKind, string> = {
    overview: 'pi pi-home',
    environments: 'pi pi-globe',
    environment: 'pi pi-globe',
    settings: 'pi pi-cog',
    collection: 'pi pi-box',
    folder: 'pi pi-folder',
    request: 'pi pi-file',
    history: 'pi pi-history',
    workspaces: 'pi pi-th-large'
};
