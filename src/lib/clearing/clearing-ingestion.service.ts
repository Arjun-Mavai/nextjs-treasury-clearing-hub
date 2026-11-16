import crypto from 'crypto';
import { z } from 'zod';
import { ClearingError } from '../errors/clearing-error';
import { FxRateEngine } from '../fx/fx-rate-engine';
import {
  computeCanonicalPayloadHash,
  normalizeIdempotencyKey,
} from '../idempotency/replay-guard';
import {
  assertJournalBalanced,
  JournalPostingLine,
} from '../math/minor-unit-ledger';
import { TenantPolicyRegistry } from '../merchants/tier-policy';
import {
  ClearingLedgerEntry,
  ClearingJournalStore,
} from '../store/journal-store';
import { calculateClearingDeductions } from '../tax/withholding-calculator';
import { buildAuditRecord } from '../audit/compliance-redactor';

export const IngestClearingEntrySchema = z.object({
  externalOrderId: z.string().trim().min(3),
  sourceAmountMinor: z.number().int().positive(),
  sourceCurrency: z.enum(['INR', 'USD', 'EUR', 'GBP']),
  customerEmail: z.string().email(),
  autoClear: z.boolean().optional().default(true),
  waiveReserve: z.boolean().optional().default(false),
  expectedVersion: z.number().int().positive().optional(),
});

export type IngestClearingEntryDto = z.infer<typeof IngestClearingEntrySchema>;

export interface IngestClearingResult {
  outcome: 'created' | 'duplicate_ignored';
  entry: ClearingLedgerEntry;
}

export class ClearingIngestionService {
  constructor(
    private readonly store: ClearingJournalStore,
    private readonly registry: TenantPolicyRegistry,
    private readonly fxEngine: FxRateEngine,
  ) {}

  public ingestEntry(params: {
    tenantId: string;
    rawIdempotencyKey: string | null | undefined;
    rawBody: unknown;
  }): IngestClearingResult {
    const tenant = this.registry.assertActiveTenant(params.tenantId);
    const normalizedKey = normalizeIdempotencyKey(params.rawIdempotencyKey);

    const parsed = IngestClearingEntrySchema.safeParse(params.rawBody);
    if (!parsed.success) {
      throw new ClearingError(
        `Invalid clearing entry payload: ${parsed.error.issues[0]?.message ?? 'validation error'}`,
        422,
        'INVALID_PAYLOAD',
      );
    }
    const dto = parsed.data;

    if (!tenant.allowedSourceCurrencies.includes(dto.sourceCurrency)) {
      throw new ClearingError(
        `Currency ${dto.sourceCurrency} is not allowed for tenant ${tenant.tenantId}`,
        403,
        'CURRENCY_NOT_ALLOWED',
      );
    }

    const incomingHash = computeCanonicalPayloadHash(dto);
    const existing = this.store.findEntryByIdempotencyKey(
      tenant.tenantId,
      normalizedKey,
    );

    if (existing) {
      if (existing.payloadHash && existing.payloadHash !== incomingHash) {
        throw new ClearingError(
          `Idempotency conflict for key '${normalizedKey}'`,
          409,
          'IDEMPOTENCY_CONFLICT',
        );
      }
      return {
        outcome: 'duplicate_ignored',
        entry: existing,
      };
    }

    const schedule = this.registry.getEffectiveFeeSchedule(tenant);
    const fx = this.fxEngine.convertMinorUnits({
      sourceAmountMinor: dto.sourceAmountMinor,
      sourceCurrency: dto.sourceCurrency,
      targetCurrency: tenant.settlementCurrency,
      spreadBps: schedule.fxSpreadBps,
    });

    const deductions = calculateClearingDeductions({
      grossSettlementMinor: fx.targetAmountMinor,
      schedule,
      currency: tenant.settlementCurrency,
      waiveReserve: dto.waiveReserve,
    });

    const now = new Date().toISOString();
    const entryId = `clr-${crypto.randomUUID()}`;

    const lines: JournalPostingLine[] = [
      {
        lineId: `ln-${crypto.randomUUID()}`,
        entryId,
        tenantId: tenant.tenantId,
        account: '1010_GATEWAY_RECEIVABLE',
        direction: 'DEBIT',
        amountMinor: deductions.grossSettlementMinor,
        currency: tenant.settlementCurrency,
        memo: `Capture receivable for ${dto.externalOrderId}`,
        postedAt: now,
      },
      {
        lineId: `ln-${crypto.randomUUID()}`,
        entryId,
        tenantId: tenant.tenantId,
        account: '2010_MERCHANT_PAYABLE',
        direction: 'CREDIT',
        amountMinor: deductions.netMerchantPayableMinor,
        currency: tenant.settlementCurrency,
        memo: `Net payable for ${dto.externalOrderId}`,
        postedAt: now,
      },
      {
        lineId: `ln-${crypto.randomUUID()}`,
        entryId,
        tenantId: tenant.tenantId,
        account: '4010_PLATFORM_FEE_REVENUE',
        direction: 'CREDIT',
        amountMinor: deductions.commissionMinor,
        currency: tenant.settlementCurrency,
        memo: `Platform commission for ${dto.externalOrderId}`,
        postedAt: now,
      },
      {
        lineId: `ln-${crypto.randomUUID()}`,
        entryId,
        tenantId: tenant.tenantId,
        account: '2040_TAX_GST_PAYABLE',
        direction: 'CREDIT',
        amountMinor: deductions.gstOnCommissionMinor,
        currency: tenant.settlementCurrency,
        memo: `GST on commission for ${dto.externalOrderId}`,
        postedAt: now,
      },
      {
        lineId: `ln-${crypto.randomUUID()}`,
        entryId,
        tenantId: tenant.tenantId,
        account: '2030_TAX_TDS_PAYABLE',
        direction: 'CREDIT',
        amountMinor: deductions.tdsWithheldMinor,
        currency: tenant.settlementCurrency,
        memo: `TDS withholding for ${dto.externalOrderId}`,
        postedAt: now,
      },
      {
        lineId: `ln-${crypto.randomUUID()}`,
        entryId,
        tenantId: tenant.tenantId,
        account: '2020_ROLLING_RESERVE_LIABILITY',
        direction: 'CREDIT',
        amountMinor: deductions.rollingReserveMinor,
        currency: tenant.settlementCurrency,
        memo: `Rolling reserve holdback for ${dto.externalOrderId}`,
        postedAt: now,
      },
    ];

    assertJournalBalanced(lines, tenant.settlementCurrency);

    const record: ClearingLedgerEntry = {
      entryId,
      tenantId: tenant.tenantId,
      idempotencyKey: normalizedKey,
      externalOrderId: dto.externalOrderId,
      version: 1,
      sourceAmountMinor: dto.sourceAmountMinor,
      sourceCurrency: dto.sourceCurrency,
      settlementCurrency: tenant.settlementCurrency,
      fxEffectiveRate: fx.effectiveRate,
      fxSpreadCostMinor: fx.fxSpreadCostMinor,
      grossSettlementMinor: deductions.grossSettlementMinor,
      commissionMinor: deductions.commissionMinor,
      gstOnCommissionMinor: deductions.gstOnCommissionMinor,
      tdsWithheldMinor: deductions.tdsWithheldMinor,
      rollingReserveMinor: deductions.rollingReserveMinor,
      netMerchantPayableMinor: deductions.netMerchantPayableMinor,
      refundedMinor: 0,
      customerEmail: dto.customerEmail,
      payloadHash: incomingHash,
      status: dto.autoClear ? 'CLEARED' : 'PENDING',
      createdAt: now,
      updatedAt: now,
    };

    this.store.saveEntry(record);
    this.store.appendJournalLines(lines);

    if (deductions.rollingReserveMinor > 0) {
      this.registry.adjustReserveVaultBalance(
        tenant.tenantId,
        deductions.rollingReserveMinor,
      );
    }

    this.store.appendAudit(
      buildAuditRecord({
        tenantId: tenant.tenantId,
        action: 'CLEARING_ENTRY_POSTED',
        entityId: record.entryId,
        actorEmail: dto.customerEmail,
        taxPanNumber: tenant.taxPanNumber,
        payoutBankAccount: tenant.payoutBankAccount,
        details: {
          externalOrderId: dto.externalOrderId,
          grossSettlementMinor: record.grossSettlementMinor,
          netMerchantPayableMinor: record.netMerchantPayableMinor,
        },
      }),
    );

    return {
      outcome: 'created',
      entry: record,
    };
  }
}