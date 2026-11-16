import crypto from 'crypto';
import { ClearingError } from '../errors/clearing-error';
import {
  assertNonNegativeMinorUnit,
  assertPositiveMinorUnit,
  bankersRound,
  JournalPostingLine,
  SupportedCurrency,
} from '../math/minor-unit-ledger';

export interface SplitRecipientRule {
  recipientId: string;
  accountCode: string;
  shareBps: number;
  fixedFeeMinor?: number;
  isPrimaryResidual?: boolean;
}

export interface ComputedSplitAllocation {
  recipientId: string;
  accountCode: string;
  shareBps: number;
  percentagePartMinor: number;
  fixedFeeMinor: number;
  residualAdjustmentMinor: number;
  finalAllocatedMinor: number;
}

export interface SplitAllocationPlan {
  planId: string;
  entryId: string;
  tenantId: string;
  totalDistributableMinor: number;
  currency: SupportedCurrency;
  allocations: ComputedSplitAllocation[];
  totalAllocatedMinor: number;
  isExactMatch: boolean;
}

export class MultiVendorSplitterService {
  public validateSplitRules(rules: SplitRecipientRule[]): void {
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new ClearingError(
        'At least one split recipient rule is required',
        422,
        'INVALID_PAYLOAD',
      );
    }

    const seenRecipients = new Set<string>();
    let totalBps = 0;
    let primaryCount = 0;

    for (const rule of rules) {
      const id = rule.recipientId.trim().toLowerCase();
      if (!id) {
        throw new ClearingError(
          'recipientId cannot be blank',
          422,
          'INVALID_PAYLOAD',
        );
      }
      if (seenRecipients.has(id)) {
        throw new ClearingError(
          `Duplicate split recipient '${id}'`,
          422,
          'INVALID_PAYLOAD',
        );
      }
      seenRecipients.add(id);

      if (!Number.isInteger(rule.shareBps) || rule.shareBps < 0 || rule.shareBps > 10000) {
        throw new ClearingError(
          `Invalid shareBps ${rule.shareBps} for recipient '${id}'`,
          422,
          'INVALID_PAYLOAD',
        );
      }

      if (rule.fixedFeeMinor !== undefined) {
        assertNonNegativeMinorUnit(rule.fixedFeeMinor, 'fixedFeeMinor');
      }

      totalBps += rule.shareBps;
      if (rule.isPrimaryResidual) {
        primaryCount += 1;
      }
    }

    if (totalBps !== 10000) {
      throw new ClearingError(
        `Split shareBps must sum to 10000, got ${totalBps}`,
        422,
        'INVALID_PAYLOAD',
      );
    }

    if (primaryCount > 1) {
      throw new ClearingError(
        'Only one recipient can be marked as isPrimaryResidual',
        422,
        'INVALID_PAYLOAD',
      );
    }
  }

  public computeSplitPlan(params: {
    entryId: string;
    tenantId: string;
    netDistributableMinor: number;
    currency: SupportedCurrency;
    rules: SplitRecipientRule[];
  }): SplitAllocationPlan {
    const { entryId, tenantId, netDistributableMinor, currency, rules } = params;
    assertPositiveMinorUnit(netDistributableMinor, 'netDistributableMinor');
    this.validateSplitRules(rules);

    const totalFixedMinor = rules.reduce(
      (sum, r) => sum + (r.fixedFeeMinor ?? 0),
      0,
    );

    if (totalFixedMinor > netDistributableMinor) {
      throw new ClearingError(
        `Total fixed split fees (${totalFixedMinor}) exceed distributable net (${netDistributableMinor})`,
        422,
        'INSUFFICIENT_SETTLEABLE_BALANCE',
      );
    }

    const variablePoolMinor = netDistributableMinor - totalFixedMinor;
    const allocations: ComputedSplitAllocation[] = [];
    let runningSum = 0;

    for (const rule of rules) {
      const fixedPart = rule.fixedFeeMinor ?? 0;
      const exactVar = (variablePoolMinor * rule.shareBps) / 10000;
      const percentagePart = bankersRound(exactVar);
      const subtotal = fixedPart + percentagePart;
      runningSum += subtotal;

      allocations.push({
        recipientId: rule.recipientId.trim().toLowerCase(),
        accountCode: rule.accountCode.trim(),
        shareBps: rule.shareBps,
        percentagePartMinor: percentagePart,
        fixedFeeMinor: fixedPart,
        residualAdjustmentMinor: 0,
        finalAllocatedMinor: subtotal,
      });
    }

    const remainderMinor = netDistributableMinor - runningSum;
    if (remainderMinor !== 0) {
      const primaryIdx = rules.findIndex((r) => r.isPrimaryResidual === true);
      const targetIdx = primaryIdx >= 0 ? primaryIdx : 0;
      const target = allocations[targetIdx];
      const adjusted = target.finalAllocatedMinor + remainderMinor;
      if (adjusted < 0) {
        throw new ClearingError(
          'Residual adjustment resulted in negative recipient allocation',
          422,
          'LEDGER_IMBALANCE_DETECTED',
        );
      }
      target.residualAdjustmentMinor = remainderMinor;
      target.finalAllocatedMinor = adjusted;
    }

    const totalAllocatedMinor = allocations.reduce(
      (acc, a) => acc + a.finalAllocatedMinor,
      0,
    );

    return {
      planId: `spl-${crypto.randomUUID()}`,
      entryId,
      tenantId: tenantId.trim().toLowerCase(),
      totalDistributableMinor: netDistributableMinor,
      currency,
      allocations,
      totalAllocatedMinor,
      isExactMatch: totalAllocatedMinor === netDistributableMinor,
    };
  }

  public buildSplitJournalLines(plan: SplitAllocationPlan): JournalPostingLine[] {
    const now = new Date().toISOString();
    const lines: JournalPostingLine[] = [
      {
        lineId: `ln-${crypto.randomUUID()}`,
        entryId: plan.entryId,
        tenantId: plan.tenantId,
        account: '2010_MERCHANT_PAYABLE',
        direction: 'DEBIT',
        amountMinor: plan.totalDistributableMinor,
        currency: plan.currency,
        memo: `Split distribution debit for plan ${plan.planId}`,
        postedAt: now,
      },
    ];

    for (const alloc of plan.allocations) {
      lines.push({
        lineId: `ln-${crypto.randomUUID()}`,
        entryId: plan.entryId,
        tenantId: plan.tenantId,
        account: '2010_MERCHANT_PAYABLE',
        direction: 'CREDIT',
        amountMinor: alloc.finalAllocatedMinor,
        currency: plan.currency,
        memo: `Vendor payout credit -> ${alloc.recipientId} (${alloc.accountCode})`,
        postedAt: now,
      });
    }

    return lines;
  }
}