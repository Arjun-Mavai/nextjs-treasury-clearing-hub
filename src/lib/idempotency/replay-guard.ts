import crypto from 'crypto';
import { ClearingError } from '../errors/clearing-error';

/**
 * Computes a SHA-256 fingerprint for idempotency payload comparison.
 * BUG: Uses raw JSON.stringify without recursive key sorting, so reordered
 * JSON keys produce different hashes and trigger false conflicts (or vice versa).
 */
export function computeCanonicalPayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export function normalizeIdempotencyKey(rawKey: string | null | undefined): string {
  if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
    throw new ClearingError(
      'x-idempotency-key header is required and cannot be blank',
      400,
      'MISSING_IDEMPOTENCY_KEY',
    );
  }
  return rawKey.trim().toLowerCase();
}