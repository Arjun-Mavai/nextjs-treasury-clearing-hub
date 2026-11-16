import crypto from 'crypto';
import {
  assertValidEntryTransition,
  ClearingEntryStatus,
} from '../clearing/clearing-state-machine';
import { ClearingError } from '../errors/clearing-error';
import { assertPositiveMinorUnit } from '../math/minor-unit-ledger';
import { TenantPolicyRegistry } from '../merchants/tier-policy';
import {
  ChargebackDisputeCase,
  ClearingJournalStore,
} from '../store/journal-store';
import { buildAuditRecord } from '../audit/compliance-redactor';

export class ChargebackClawbackService {
  constructor(
    private readonly store: ClearingJournalStore,
    private readonly registry: TenantPolicyRegistry,
  ) {}

  public openChargeback(params: {
    tenantId: string;
    entryId: string;
    reasonCode: string;
    disputedMinor?: number;
  }): ChargebackDisputeCase {
    const tenant = this.registry.assertActiveTenant(params.tenantId);
    const entry = this.store.findEntryById(params.entryId);

    if (!entry || entry.tenantId !== tenant.tenantId) {
      throw new ClearingError(
        `Clearing entry '${params.entryId}' not found`,
        404,
        'ENTRY_NOT_FOUND',
      );
    }

    const existingOpen = this.store.findOpenDisputesForEntry(entry.entryId);
    if (existingOpen.length > 0) {
      throw new ClearingError(
        `Entry '${entry.entryId}' already has an active dispute`,
        409,
        'DISPUTE_ALREADY_ACTIVE',
      );
    }

    const maxDisputable = entry.grossSettlementMinor - entry.refundedMinor;
    const disputedMinor = params.disputedMinor ?? maxDisputable;
    assertPositiveMinorUnit(disputedMinor, 'disputedMinor');

    if (disputedMinor > maxDisputable) {
      throw new ClearingError(
        `Disputed amount ${disputedMinor} exceeds remaining non-refunded amount ${maxDisputable}`,
        422,
        'INVALID_PAYLOAD',
      );
    }

    assertValidEntryTransition(entry.status, 'DISPUTED', entry.entryId);

    let clawedBackFromReserveMinor = 0;
    if (entry.status === 'BATCHED' || entry.status === 'SETTLED') {
      clawedBackFromReserveMinor = disputedMinor;
      this.registry.adjustReserveVaultBalance(
        tenant.tenantId,
        -clawedBackFromReserveMinor,
      );
    }

    const now = new Date().toISOString();
    const dispute: ChargebackDisputeCase = {
      disputeId: `dsp-${crypto.randomUUID()}`,
      entryId: entry.entryId,
      tenantId: tenant.tenantId,
      reasonCode: params.reasonCode.trim() || 'GENERAL_CHARGEBACK',
      disputedMinor,
      clawedBackFromReserveMinor,
      status: 'OPEN',
      openedAt: now,
    };

    entry.status = 'DISPUTED';
    entry.version += 1;
    entry.updatedAt = now;

    this.store.saveEntry(entry);
    this.store.saveDispute(dispute);

    this.store.appendAudit(
      buildAuditRecord({
        tenantId: tenant.tenantId,
        action: 'CHARGEBACK_OPENED',
        entityId: dispute.disputeId,
        actorEmail: entry.customerEmail,
        details: {
          entryId: entry.entryId,
          disputedMinor,
          clawedBackFromReserveMinor,
        },
      }),
    );

    return dispute;
  }

  public resolveChargeback(params: {
    tenantId: string;
    disputeId: string;
    outcome: 'WON_MERCHANT' | 'LOST_CUSTOMER';
  }): ChargebackDisputeCase {
    const tenant = this.registry.assertActiveTenant(params.tenantId);
    const db = this.store.readAll();
    const dispute = db.disputes.find(
      (d) => d.disputeId === params.disputeId && d.tenantId === tenant.tenantId,
    );

    if (!dispute) {
      throw new ClearingError(
        `Dispute '${params.disputeId}' not found`,
        404,
        'DISPUTE_NOT_FOUND',
      );
    }

    const entry = this.store.findEntryById(dispute.entryId);
    if (!entry) {
      throw new ClearingError(
        `Entry '${dispute.entryId}' missing for dispute`,
        404,
        'ENTRY_NOT_FOUND',
      );
    }

    const now = new Date().toISOString();
    dispute.status = params.outcome;
    dispute.closedAt = now;

    let nextEntryStatus: ClearingEntryStatus;
    if (params.outcome === 'WON_MERCHANT') {
      if (dispute.clawedBackFromReserveMinor > 0) {
        this.registry.adjustReserveVaultBalance(
          tenant.tenantId,
          dispute.clawedBackFromReserveMinor,
        );
      }
      nextEntryStatus =
        entry.refundedMinor > 0 ? 'PARTIALLY_REFUNDED' : 'CLEARED';
    } else {
      entry.refundedMinor += dispute.disputedMinor;
      nextEntryStatus =
        entry.refundedMinor >= entry.grossSettlementMinor
          ? 'REFUNDED'
          : 'PARTIALLY_REFUNDED';
    }

    assertValidEntryTransition(entry.status, nextEntryStatus, entry.entryId);
    entry.status = nextEntryStatus;
    entry.version += 1;
    entry.updatedAt = now;

    this.store.saveEntry(entry);
    this.store.saveDispute(dispute);

    return dispute;
  }
}