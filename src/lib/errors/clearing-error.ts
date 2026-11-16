export type ClearingErrorCode =
  | 'UNAUTHORIZED_SIGNATURE'
  | 'MISSING_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'TENANT_NOT_FOUND'
  | 'TENANT_SUSPENDED'
  | 'CURRENCY_NOT_ALLOWED'
  | 'FX_RATE_UNAVAILABLE'
  | 'INVALID_PAYLOAD'
  | 'ENTRY_NOT_FOUND'
  | 'INVALID_ENTRY_TRANSITION'
  | 'LEDGER_IMBALANCE_DETECTED'
  | 'INSUFFICIENT_SETTLEABLE_BALANCE'
  | 'INSUFFICIENT_RESERVE_FOR_CLAWBACK'
  | 'DISPUTE_ALREADY_ACTIVE'
  | 'DISPUTE_NOT_FOUND'
  | 'BATCH_NOT_FOUND'
  | 'INTERNAL_ERROR';

export class ClearingError extends Error {
  public readonly statusCode: number;
  public readonly code: ClearingErrorCode;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: ClearingErrorCode,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ClearingError';
    this.statusCode = statusCode;
    this.code = code;
    this.context = context;
  }
}

export function isClearingError(err: unknown): err is ClearingError {
  return err instanceof ClearingError;
}