import { ClearingError } from '../errors/clearing-error';

export type SupportedCurrency = 'INR' | 'USD' | 'EUR' | 'GBP';
export type JournalDirection = 'DEBIT' | 'CREDIT';

export type LedgerAccountCode =
  | '1010_GATEWAY_RECEIVABLE'
  | '2010_MERCHANT_PAYABLE'
  | '2020_ROLLING_RESERVE_LIABILITY'
  | '2030_TAX_TDS_PAYABLE'
  | '2040_TAX_GST_PAYABLE'
  | '4010_PLATFORM_FEE_REVENUE'
  | '5010_CHARGEBACK_LOSS_EXPENSE';

export interface JournalPostingLine {
  lineId: string;
  entryId: string;
  tenantId: string;
  account: LedgerAccountCode;
  direction: JournalDirection;
  amountMinor: number;
  currency: SupportedCurrency;
  memo: string;
  postedAt: string;
}

export interface BalancedJournalVerification {
  isBalanced: boolean;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  imbalanceMinor: number;
  currency: SupportedCurrency;
}

/**
 * Banker's rounding (round half to nearest even integer) to eliminate
 * systematic upward bias across high-volume clearing batches.
 */
export function bankersRound(value: number): number {
  if (!Number.isFinite(value)) {
    throw new ClearingError(
      'Cannot round non-finite numeric value',
      422,
      'INVALID_PAYLOAD',
    );
  }
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const floor = Math.floor(abs);
  const diff = abs - floor;

  if (Math.abs(diff - 0.5) < 1e-12) {
    const even = floor % 2 === 0 ? floor : floor + 1;
    return sign * even;
  }
  return sign * Math.round(abs);
}

/**
 * Legacy half-up rounding used in older tax calculators.
 * Differs from bankersRound on exact .5 ties, causing subtle 1-minor-unit drifts.
 */
export function halfUpRound(value: number): number {
  if (!Number.isFinite(value)) {
    throw new ClearingError(
      'Cannot round non-finite numeric value',
      422,
      'INVALID_PAYLOAD',
    );
  }
  return Math.round(value);
}

export function assertPositiveMinorUnit(
  amountMinor: number,
  fieldName: string,
): void {
  if (
    typeof amountMinor !== 'number' ||
    !Number.isInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    throw new ClearingError(
      `${fieldName} must be a positive integer in minor units`,
      422,
      'INVALID_PAYLOAD',
      { fieldName, received: amountMinor },
    );
  }
}

export function assertNonNegativeMinorUnit(
  amountMinor: number,
  fieldName: string,
): void {
  if (
    typeof amountMinor !== 'number' ||
    !Number.isInteger(amountMinor) ||
    amountMinor < 0
  ) {
    throw new ClearingError(
      `${fieldName} must be a non-negative integer in minor units`,
      422,
      'INVALID_PAYLOAD',
      { fieldName, received: amountMinor },
    );
  }
}

export function verifyJournalLinesBalanced(
  lines: JournalPostingLine[],
  expectedCurrency: SupportedCurrency,
): BalancedJournalVerification {
  let totalDebitsMinor = 0;
  let totalCreditsMinor = 0;

  for (const line of lines) {
    if (line.currency !== expectedCurrency) {
      throw new ClearingError(
        `Mixed currency in journal lines: expected ${expectedCurrency}, got ${line.currency}`,
        422,
        'LEDGER_IMBALANCE_DETECTED',
      );
    }
    if (!Number.isInteger(line.amountMinor) || line.amountMinor < 0) {
      throw new ClearingError(
        `Journal line ${line.lineId} has non-integer or negative amount ${line.amountMinor}`,
        422,
        'LEDGER_IMBALANCE_DETECTED',
      );
    }
    if (line.direction === 'DEBIT') {
      totalDebitsMinor += line.amountMinor;
    } else {
      totalCreditsMinor += line.amountMinor;
    }
  }

  const imbalanceMinor = totalDebitsMinor - totalCreditsMinor;
  return {
    isBalanced: imbalanceMinor === 0 && lines.length > 0,
    totalDebitsMinor,
    totalCreditsMinor,
    imbalanceMinor,
    currency: expectedCurrency,
  };
}

export function assertJournalBalanced(
  lines: JournalPostingLine[],
  expectedCurrency: SupportedCurrency,
): void {
  const check = verifyJournalLinesBalanced(lines, expectedCurrency);
  if (!check.isBalanced) {
    throw new ClearingError(
      `Double-entry ledger imbalance of ${check.imbalanceMinor} minor units (${expectedCurrency})`,
      422,
      'LEDGER_IMBALANCE_DETECTED',
      { ...check },
    );
  }
}