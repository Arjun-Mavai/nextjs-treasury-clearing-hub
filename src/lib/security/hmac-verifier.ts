import crypto from 'crypto';
import { ClearingError } from '../errors/clearing-error';

const LEGACY_PLACEHOLDER_SECRET = 'YOUR_API_KEY_HERE';

/**
 * Verifies incoming HMAC-SHA256 signatures.
 * BUGS FOR TASK 2:
 * 1. Falls back to LEGACY_PLACEHOLDER_SECRET when CLEARING_HMAC_SECRET is unset.
 * 2. Uses plain `===` instead of `crypto.timingSafeEqual` with strict hex/buffer length checks.
 */
export function verifyClearingSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secretOverride?: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const secret =
    secretOverride ??
    process.env.CLEARING_HMAC_SECRET ??
    LEGACY_PLACEHOLDER_SECRET;

  const providedHex = signatureHeader.slice('sha256='.length);
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return providedHex === expectedHex;
}

export function assertValidClearingSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secretOverride?: string,
): void {
  const ok = verifyClearingSignature(rawBody, signatureHeader, secretOverride);
  if (!ok) {
    throw new ClearingError(
      'Invalid or missing x-clearing-signature header',
      401,
      'UNAUTHORIZED_SIGNATURE',
    );
  }
}