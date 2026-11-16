import crypto from 'crypto';
import {
  maskBankAccountNumber,
  maskEmailAddress,
  maskPanIdentifier,
} from '../audit/compliance-redactor';
import {
  ClearingLedgerEntry,
  SettlementBatchEntity,
} from '../store/journal-store';
import { TenantClearingProfile } from '../merchants/tier-policy';

export type TreasuryWebhookTopic =
  | 'clearing.entry.created'
  | 'clearing.entry.disputed'
  | 'settlement.batch.disbursed';

export interface SignedOutboundWebhook {
  webhookId: string;
  topic: TreasuryWebhookTopic;
  tenantId: string;
  attemptCount: number;
  nextRetryDelayMs: number;
  signatureHeader: string;
  timestampHeader: string;
  body: Record<string, unknown>;
}

const RETRY_BACKOFF_SCHEDULE_MS = [1000, 5000, 30000, 120000, 600000];

export class OutboundWebhookDispatcher {
  private readonly queue: SignedOutboundWebhook[] = [];

  public computeNextBackoffMs(attemptCount: number): number {
    if (attemptCount <= 0) {
      return RETRY_BACKOFF_SCHEDULE_MS[0];
    }
    const idx = Math.min(
      attemptCount - 1,
      RETRY_BACKOFF_SCHEDULE_MS.length - 1,
    );
    return RETRY_BACKOFF_SCHEDULE_MS[idx];
  }

  public signPayload(rawJson: string, secretOverride?: string): string {
    const secret =
      secretOverride ??
      process.env.CLEARING_HMAC_SECRET ??
      'YOUR_API_KEY_HERE';
    const digest = crypto
      .createHmac('sha256', secret)
      .update(rawJson)
      .digest('hex');
    return `sha256=${digest}`;
  }

  public enqueueEntryCreatedWebhook(
    entry: ClearingLedgerEntry,
    secretOverride?: string,
  ): SignedOutboundWebhook {
    const timestampHeader = new Date().toISOString();
    const sanitizedBody: Record<string, unknown> = {
      entryId: entry.entryId,
      tenantId: entry.tenantId,
      externalOrderId: entry.externalOrderId,
      sourceAmountMinor: entry.sourceAmountMinor,
      sourceCurrency: entry.sourceCurrency,
      settlementCurrency: entry.settlementCurrency,
      grossSettlementMinor: entry.grossSettlementMinor,
      netMerchantPayableMinor: entry.netMerchantPayableMinor,
      customerEmailMasked: maskEmailAddress(entry.customerEmail),
      status: entry.status,
      createdAt: entry.createdAt,
    };

    const rawJson = JSON.stringify(sanitizedBody);
    const envelope: SignedOutboundWebhook = {
      webhookId: `whk-${crypto.randomUUID()}`,
      topic: 'clearing.entry.created',
      tenantId: entry.tenantId,
      attemptCount: 1,
      nextRetryDelayMs: this.computeNextBackoffMs(1),
      signatureHeader: this.signPayload(rawJson, secretOverride),
      timestampHeader,
      body: sanitizedBody,
    };

    this.queue.push(envelope);
    return envelope;
  }

  public enqueueBatchDisbursedWebhook(
    batch: SettlementBatchEntity,
    tenant: TenantClearingProfile,
    secretOverride?: string,
  ): SignedOutboundWebhook {
    const timestampHeader = new Date().toISOString();
    const sanitizedBody: Record<string, unknown> = {
      batchId: batch.batchId,
      tenantId: batch.tenantId,
      entryCount: batch.entryIds.length,
      currency: batch.currency,
      totalGrossMinor: batch.totalGrossMinor,
      totalNetPayoutMinor: batch.totalNetPayoutMinor,
      payoutBankMasked: maskBankAccountNumber(tenant.payoutBankAccount),
      taxPanMasked: maskPanIdentifier(tenant.taxPanNumber),
      complianceEmailMasked: maskEmailAddress(tenant.complianceEmail),
      createdAt: batch.createdAt,
    };

    const rawJson = JSON.stringify(sanitizedBody);
    const envelope: SignedOutboundWebhook = {
      webhookId: `whk-${crypto.randomUUID()}`,
      topic: 'settlement.batch.disbursed',
      tenantId: batch.tenantId,
      attemptCount: 1,
      nextRetryDelayMs: this.computeNextBackoffMs(1),
      signatureHeader: this.signPayload(rawJson, secretOverride),
      timestampHeader,
      body: sanitizedBody,
    };

    this.queue.push(envelope);
    return envelope;
  }

  public listPendingWebhooks(tenantId?: string): SignedOutboundWebhook[] {
    if (!tenantId) {
      return [...this.queue];
    }
    const norm = tenantId.trim().toLowerCase();
    return this.queue.filter((w) => w.tenantId === norm);
  }

  public clearQueue(): void {
    this.queue.length = 0;
  }
}