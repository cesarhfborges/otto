import { randomUUID } from 'node:crypto';
import type { IClock, IIdGenerator } from '../../core/contracts';

export const systemClock: IClock = { now: () => new Date().toISOString() };

export const uuidGenerator: IIdGenerator = { next: () => randomUUID() };
