import crypto from 'crypto';

export interface ComplianceAuditRecord {
  auditId: string;
  tenantId: string;
  action: string;
  entityId: string;
  actorEmail: string;
  taxPanNumber?: string;
  payoutBankAccount?: string;
  details: Record<string, unknown>;
  recordedAt: string;
}

export function maskEmailAddress(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 1) {
    return '***@***';
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function maskPanIdentifier(pan: string): string {
  const clean = pan.trim().toUpperCase();
  if (clean.length < 4) {
    return '****';
  }
  return `${clean.slice(0, 2)}****${clean.slice(-2)}`;
}

export function maskBankAccountNumber(acct: string): string {
  const clean = acct.replace(/\s+/g, '');
  if (clean.length <= 4) {
    return '****';
  }
  return `****${clean.slice(-4)}`;
}

export function buildAuditRecord(params: {
  tenantId: string;
  action: string;
  entityId: string;
  actorEmail: string;
  taxPanNumber?: string;
  payoutBankAccount?: string;
  details?: Record<string, unknown>;
}): ComplianceAuditRecord {
  return {
    auditId: `aud-${crypto.randomUUID()}`,
    tenantId: params.tenantId,
    action: params.action,
    entityId: params.entityId,
    actorEmail: params.actorEmail,
    taxPanNumber: params.taxPanNumber,
    payoutBankAccount: params.payoutBankAccount,
    details: params.details ?? {},
    recordedAt: new Date().toISOString(),
  };
}