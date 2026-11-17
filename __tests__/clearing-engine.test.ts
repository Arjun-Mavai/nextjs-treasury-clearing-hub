import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ClearingJournalStore } from '@/lib/store/journal-store';
import { TenantPolicyRegistry } from '@/lib/merchants/tier-policy';
import { FxRateEngine } from '@/lib/fx/fx-rate-engine';
import { ClearingIngestionService } from '@/lib/clearing/clearing-ingestion.service';
import { ChargebackClawbackService } from '@/lib/disputes/chargeback-clawback';
import { SettlementBatcherService } from '@/lib/settlements/settlement-batcher';
import { StatementMatcherService } from '@/lib/reconciliation/statement-matcher';
import { verifyClearingSignature } from '@/lib/security/hmac-verifier';

describe('Treasury Clearing & Settlement Engine Baseline', () => {
  let tmpJournal: string;
  let store: ClearingJournalStore;
  let registry: TenantPolicyRegistry;
  let fxEngine: FxRateEngine;
  let ingestion: ClearingIngestionService;
  let disputes: ChargebackClawbackService;
  let batcher: SettlementBatcherService;
  let reconciler: StatementMatcherService;

  beforeEach(() => {
    tmpJournal = path.join(
      os.tmpdir(),
      `clearing-test-${crypto.randomUUID()}.json`,
    );
    store = new ClearingJournalStore(tmpJournal);
    store.reset();
    registry = new TenantPolicyRegistry();
    fxEngine = new FxRateEngine();
    ingestion = new ClearingIngestionService(store, registry, fxEngine);
    disputes = new ChargebackClawbackService(store, registry);
    batcher = new SettlementBatcherService(store, registry);
    reconciler = new StatementMatcherService(store, registry);
  });

  it('verifies valid HMAC signatures', () => {
    const raw = JSON.stringify({ externalOrderId: 'ORD-1', sourceAmountMinor: 10000 });
    const sig =
      'sha256=' +
      crypto
        .createHmac('sha256', 'YOUR_API_KEY_HERE')
        .update(raw)
        .digest('hex');

    expect(verifyClearingSignature(raw, sig, 'YOUR_API_KEY_HERE')).toBe(true);
    expect(verifyClearingSignature(raw, 'sha256=bad', 'YOUR_API_KEY_HERE')).toBe(
      false,
    );
  });

  it('ingests an INR clearing entry and maintains double-entry ledger balance', () => {
    const res = ingestion.ingestEntry({
      tenantId: 'mock_tenant_alpha',
      rawIdempotencyKey: 'mock_idem_001',
      rawBody: {
        externalOrderId: 'ORD-1001',
        sourceAmountMinor: 100000,
        sourceCurrency: 'INR',
        customerEmail: 'user1@test.local',
      },
    });

    expect(res.outcome).toBe('created');
    expect(res.entry.grossSettlementMinor).toBe(100000);
    expect(res.entry.commissionMinor).toBe(1850);
    expect(res.entry.gstOnCommissionMinor).toBe(333);
    expect(res.entry.tdsWithheldMinor).toBe(1000);
    expect(res.entry.rollingReserveMinor).toBe(2500);
    expect(res.entry.netMerchantPayableMinor).toBe(94317);

    const recon = reconciler.reconcileTenant('mock_tenant_alpha');
    expect(recon.journalVerification.isBalanced).toBe(true);
  });

  it('converts USD to INR using FxRateEngine and settles batch', () => {
    const res = ingestion.ingestEntry({
      tenantId: 'mock_tenant_alpha',
      rawIdempotencyKey: 'idem-fx-1',
      rawBody: {
        externalOrderId: 'ORD-FX-200',
        sourceAmountMinor: 10000,
        sourceCurrency: 'USD',
        customerEmail: 'user1@test.local',
      },
    });

    expect(res.outcome).toBe('created');
    expect(res.entry.settlementCurrency).toBe('INR');

    const batch = batcher.createSettlementBatch({ tenantId: 'mock_tenant_alpha' });
    expect(batch.entryIds).toContain(res.entry.entryId);
    expect(batch.totalNetPayoutMinor).toBe(res.entry.netMerchantPayableMinor);
  });

  it('handles chargeback dispute and reserve vault clawback on settled entry', () => {
    const created = ingestion.ingestEntry({
      tenantId: 'mock_tenant_alpha',
      rawIdempotencyKey: 'idem-cb-1',
      rawBody: {
        externalOrderId: 'ORD-CB-300',
        sourceAmountMinor: 50000,
        sourceCurrency: 'INR',
        customerEmail: 'user1@test.local',
      },
    });

    batcher.createSettlementBatch({ tenantId: 'mock_tenant_alpha' });
    const beforeVault = registry.getTenant('mock_tenant_alpha')!.reserveVaultBalanceMinor;

    const dsp = disputes.openChargeback({
      tenantId: 'mock_tenant_alpha',
      entryId: created.entry.entryId,
      reasonCode: 'FRAUD_DISPUTE',
    });

    expect(dsp.clawedBackFromReserveMinor).toBe(50000);
    const afterVault = registry.getTenant('mock_tenant_alpha')!.reserveVaultBalanceMinor;
    expect(afterVault).toBe(beforeVault - 50000);

    if (fs.existsSync(tmpJournal)) {
      fs.unlinkSync(tmpJournal);
    }
  });
});