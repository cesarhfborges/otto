import type { Migration } from '../../../core/contracts';
import { initialSchema } from './001-initial-schema';
import { workspaceState } from './002-workspace-state';
import { workspaces } from './003-workspaces';
import { historyDetail } from './004-history-detail';
import { dropHistory } from './005-drop-history';

/** Lista ordenada de migrações. Nunca altere uma migração já publicada: crie uma nova. */
export const MIGRATIONS: readonly Migration[] = [initialSchema, workspaceState, workspaces, historyDetail, dropHistory];
