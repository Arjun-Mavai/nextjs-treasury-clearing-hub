import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ClearingJournalStore } from '@/lib/store/journal-store';
import { TenantPolicyRegistry } from '@/lib/merchants/tier-policy';
import { FxRateEngine } from '@/lib/fx/fx-rate-engine';
import { ClearingIngestionService } from '@/lib/clearing/clearing-ingestion.service';
import { MultiVendorSplitterService } from '@/lib/splits/multi-vendor-splitter';
import { LiquidityForecastService } from '@/lib/treasury/liquidity-forecast.service';
import { OutboundWebhookDispatcher } from '@/lib/webhooks/outbound-dispatcher';
import { verifyJournalLinesBalanced } from '@/lib/math/minor-unit-ledger';

describe('Multi-Vendor Split, Liquidity & Webhook Outbox Suite', () => {
  let tmpFile: string;
  let store: ClearingJournalStore;
  let registry: TenantPolicyRegistry;
  let fxEngine: FxRateEngine;
  let ingestion: ClearingIngestionService;
  let splitter: MultiVendorSplitterService;
  let liquidity: LiquidityForecastService;
  let webhooks: OutboundWebhookDispatcher;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `treasury-split-${crypto.randomUUID()}.json`);
    store = new ClearingJournalStore(tmpFile);
    store.reset();
    registry = new TenantPolicyRegistry();
    fxEngine = new FxRateEngine();
    ingestion = new ClearingIngestionService(store, registry, fxEngine);
    splitter = new MultiVendorSplitterService();
    liquidity = new LiquidityForecastService(store, registry);
    webhooks = new OutboundWebhookDispatcher();
  });

  it('allocates marketplace split payouts with remainder minor units to primary vendor', () => {
    const plan = splitter.computeSplitPlan({
      entryId: 'clr-demo-1',
      tenantId: 'tenant-orion',
      netDistributableMinor: 10001,
      currency: 'INR',
      rules: [
        { recipientId: 'vendor-a', accountCode: 'ACC-A', shareBps: 3333, isPrimaryResidual: true },
        { recipientId: 'vendor-b', accountCode: 'ACC-B', shareBps: 3333 },
        { recipientId: 'vendor-c', accountCode: 'ACC-C', shareBps: 3334 },
      ],
    });

    expect(plan.isExactMatch).toBe(true);
    expect(plan.totalAllocatedMinor).toBe(10001);

    const lines = splitter.buildSplitJournalLines(plan);
    const check = verifyJournalLinesBalanced(lines, 'INR');
    expect(check.isBalanced).toBe(true);
  });

  it('computes liquidity exposure, aging buckets, and reserve deficit accurately', () => {
    ingestion.ingestEntry({
      tenantId: 'tenant-orion',
      rawIdempotencyKey: 'liq-key-1',
      rawBody: {
        externalOrderId: 'ORD-LIQ-1',
        sourceAmountMinor: 80000,
        sourceCurrency: 'INR',
        customerEmail: 'corp@example.com',
      },
    });

    const snap = liquidity.computeTenantLiquidity('tenant-orion');
    expect(snap.clearedSettleableMinor).toBeGreaterThan(0);
    expect(snap.agingBuckets[0].entryCount).toBe(1);

    const release = liquidity.evaluateReserveRelease('tenant-orion');
    expect(release.canReleaseNow).toBe(false);
  });

  it('masks PII fields in outbound webhook notifications', () => {
    const created = ingestion.ingestEntry({
      tenantId: 'tenant-orion',
      rawIdempotencyKey: 'wh-key-1',
      rawBody: {
        externalOrderId: 'ORD-WH-1',
        sourceAmountMinor: 40000,
        sourceCurrency: 'INR',
        customerEmail: 'alice.sharma@example.com',
      },
    });

    const env = webhooks.enqueueEntryCreatedWebhook(
      created.entry,
      'YOUR_API_KEY_HERE',
    );
    expect(env.signatureHeader.startsWith('sha256=')).toBe(true);
    expect(env.body.customerEmailMasked).toBe('a***a@example.com');

    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });
});