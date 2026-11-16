import crypto from 'crypto';
import {
  assertValidEntryTransition,
  isSettleableStatus,
} from '../clearing/clearing-state-machine';
import { ClearingError } from '../errors/clearing-error';
import { TenantPolicyRegistry } from '../merchants/tier-policy';
import {
  ClearingLedgerEntry,
  ClearingJournalStore,
  SettlementBatchEntity,
} from '../store/journal-store';
import {
  buildAuditRecord,
  maskBankAccountNumber,
} from '../audit/compliance-redactor';

export class SettlementBatcherService {
  constructor(
    private readonly store: ClearingJournalStore,
    private readonly registry: TenantPolicyRegistry,
  ) {}

  public createSettlementBatch(params: {
    tenantId: string;
    entryIds?: string[];
  }): SettlementBatchEntity {
    const tenant = this.registry.assertActiveTenant(params.tenantId);
    const tenantEntries = this.store.listEntriesByTenant(tenant.tenantId);

    let candidates: ClearingLedgerEntry[];
    if (params.entryIds && params.entryIds.length > 0) {
      candidates = params.entryIds.map((id) => {
        const found = tenantEntries.find((e) => e.entryId === id);
        if (!found) {
          throw new ClearingError(
            `Clearing entry '${id}' not found for tenant '${tenant.tenantId}'`,
            404,
            'ENTRY_NOT_FOUND',
          );
        }
        return found;
      });
    } else {
      candidates = tenantEntries.filter((e) => isSettleableStatus(e.status));
    }

    if (candidates.length === 0) {
      throw new ClearingError(
        `No settleable clearing entries available for tenant '${tenant.tenantId}'`,
        409,
        'INSUFFICIENT_SETTLEABLE_BALANCE',
      );
    }

    let totalGrossMinor = 0;
    let totalCommissionMinor = 0;
    let totalGstMinor = 0;
    let totalTdsMinor = 0;
    let totalReserveHeldMinor = 0;
    let totalNetPayoutMinor = 0;

    const now = new Date().toISOString();
    const batchId = `bat-${crypto.randomUUID()}`;

    for (const entry of candidates) {
      const openDisputes = this.store.findOpenDisputesForEntry(entry.entryId);
      if (openDisputes.length > 0) {
        throw new ClearingError(
          `Entry '${entry.entryId}' has an open dispute and cannot be settled`,
          409,
          'INVALID_ENTRY_TRANSITION',
        );
      }

      assertValidEntryTransition(entry.status, 'SETTLED', entry.entryId);

      const effectiveNet = Math.max(
        0,
        entry.netMerchantPayableMinor - entry.refundedMinor,
      );

      totalGrossMinor += entry.grossSettlementMinor;
      totalCommissionMinor += entry.commissionMinor;
      totalGstMinor += entry.gstOnCommissionMinor;
      totalTdsMinor += entry.tdsWithheldMinor;
      totalReserveHeldMinor += entry.rollingReserveMinor;
      totalNetPayoutMinor += effectiveNet;

      entry.status = 'SETTLED';
      entry.batchId = batchId;
      entry.version += 1;
      entry.updatedAt = now;
      this.store.saveEntry(entry);
    }

    const batch: SettlementBatchEntity = {
      batchId,
      tenantId: tenant.tenantId,
      entryIds: candidates.map((c) => c.entryId),
      currency: tenant.settlementCurrency,
      totalGrossMinor,
      totalCommissionMinor,
      totalGstMinor,
      totalTdsMinor,
      totalReserveHeldMinor,
      totalNetPayoutMinor,
      payoutBankMasked: maskBankAccountNumber(tenant.payoutBankAccount),
      createdAt: now,
    };

    this.store.saveBatch(batch);

    this.store.appendAudit(
      buildAuditRecord({
        tenantId: tenant.tenantId,
        action: 'SETTLEMENT_BATCH_DISBURSED',
        entityId: batch.batchId,
        actorEmail: tenant.complianceEmail,
        payoutBankAccount: tenant.payoutBankAccount,
        details: {
          entryCount: batch.entryIds.length,
          totalNetPayoutMinor,
        },
      }),
    );

    return batch;
  }
}