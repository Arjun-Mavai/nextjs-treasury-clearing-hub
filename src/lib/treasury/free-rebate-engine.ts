import { ClearingError } from '../errors/clearing-error';
import {
  bankersRound,
  SupportedCurrency,
} from '../math/minor-unit-ledger';
import {
  MerchantTier,
  TenantPolicyRegistry,
  TIER_SCHEDULES,
} from '../merchants/tier-policy';
import { ClearingJournalStore } from '../store/journal-store';

export interface MonthlyVolumeSummary {
  tenantId: string;
  monthKey: string;
  settledEntryCount: number;
  settledGrossVolumeMinor: number;
  commissionCollectedMinor: number;
  currency: SupportedCurrency;
}

export interface RebateEvaluationReport {
  tenantId: string;
  monthKey: string;
  currentTier: MerchantTier;
  eligibleTier: MerchantTier;
  settledGrossVolumeMinor: number;
  commissionCollectedMinor: number;
  rebateRateBps: number;
  rebateCreditMinor: number;
  currency: SupportedCurrency;
  upgradeRecommended: boolean;
}

const TIER_THRESHOLDS_MINOR: Record<MerchantTier, number> = {
  STARTER: 0,
  GROWTH: 1_000_000,
  ENTERPRISE: 5_000_000,
};

export class FeeRebateEngine {
  constructor(
    private readonly store: ClearingJournalStore,
    private readonly registry: TenantPolicyRegistry,
  ) {}

  public computeMonthlyVolume(
    tenantId: string,
    monthKey: string,
  ): MonthlyVolumeSummary {
    const tenant = this.registry.getTenant(tenantId);
    if (!tenant) {
      throw new ClearingError(
        `Tenant '${tenantId}' not found`,
        404,
        'TENANT_NOT_FOUND',
      );
    }

    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new ClearingError(
        'monthKey must be formatted as YYYY-MM',
        422,
        'INVALID_PAYLOAD',
      );
    }

    const entries = this.store.listEntriesByTenant(tenant.tenantId);
    let settledEntryCount = 0;
    let settledGrossVolumeMinor = 0;
    let commissionCollectedMinor = 0;

    for (const entry of entries) {
      if (entry.status !== 'SETTLED') continue;
      if (!entry.createdAt.startsWith(monthKey)) continue;

      settledEntryCount += 1;
      settledGrossVolumeMinor += entry.grossSettlementMinor;
      commissionCollectedMinor += entry.commissionMinor;
    }

    return {
      tenantId: tenant.tenantId,
      monthKey,
      settledEntryCount,
      settledGrossVolumeMinor,
      commissionCollectedMinor,
      currency: tenant.settlementCurrency,
    };
  }

  public evaluateMonthlyRebate(
    tenantId: string,
    monthKey: string,
  ): RebateEvaluationReport {
    const tenant = this.registry.assertActiveTenant(tenantId);
    const volume = this.computeMonthlyVolume(tenant.tenantId, monthKey);

    let eligibleTier: MerchantTier = 'STARTER';
    if (volume.settledGrossVolumeMinor >= TIER_THRESHOLDS_MINOR.ENTERPRISE) {
      eligibleTier = 'ENTERPRISE';
    } else if (volume.settledGrossVolumeMinor >= TIER_THRESHOLDS_MINOR.GROWTH) {
      eligibleTier = 'GROWTH';
    }

    const currentBps = TIER_SCHEDULES[tenant.tier].baseCommissionBps;
    const eligibleBps = TIER_SCHEDULES[eligibleTier].baseCommissionBps;
    const rebateRateBps = Math.max(0, currentBps - eligibleBps);

    const rebateExact =
      (volume.settledGrossVolumeMinor * rebateRateBps) / 10000;
    const rebateCreditMinor = bankersRound(rebateExact);

    return {
      tenantId: tenant.tenantId,
      monthKey,
      currentTier: tenant.tier,
      eligibleTier,
      settledGrossVolumeMinor: volume.settledGrossVolumeMinor,
      commissionCollectedMinor: volume.commissionCollectedMinor,
      rebateRateBps,
      rebateCreditMinor,
      currency: tenant.settlementCurrency,
      upgradeRecommended: eligibleTier !== tenant.tier && rebateRateBps > 0,
    };
  }
}