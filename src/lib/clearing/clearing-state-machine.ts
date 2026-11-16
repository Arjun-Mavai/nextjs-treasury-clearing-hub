import { ClearingError } from '../errors/clearing-error';

export type ClearingEntryStatus =
  | 'PENDING'
  | 'CLEARED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'BATCHED'
  | 'SETTLED';

const ALLOWED_TRANSITIONS: Record<
  ClearingEntryStatus,
  readonly ClearingEntryStatus[]
> = {
  PENDING: ['CLEARED', 'DISPUTED'],
  CLEARED: ['PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED', 'BATCHED', 'SETTLED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED', 'BATCHED', 'SETTLED'],
  REFUNDED: [],
  DISPUTED: ['CLEARED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  BATCHED: ['SETTLED', 'DISPUTED'],
  SETTLED: ['DISPUTED'],
};

export function assertValidEntryTransition(
  current: ClearingEntryStatus,
  next: ClearingEntryStatus,
  entryId: string,
): void {
  const allowed = ALLOWED_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new ClearingError(
      `Invalid clearing state transition for entry '${entryId}': ${current} -> ${next}`,
      409,
      'INVALID_ENTRY_TRANSITION',
      { entryId, current, next },
    );
  }
}

export function isSettleableStatus(status: ClearingEntryStatus): boolean {
  return status === 'CLEARED' || status === 'PARTIALLY_REFUNDED';
}