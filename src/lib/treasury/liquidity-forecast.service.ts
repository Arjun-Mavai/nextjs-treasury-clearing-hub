import { ClearingError } from '../errors/clearing-error';
import { SupportedCurrency } from '../math/minor-unit-ledger';
import { TenantPolicyRegistry } from '../merchants/tier-policy';
import {
  ClearingJournalStore,
  ClearingLedgerEntry,
} from '../store/journal-store';

export interface AgingExposureBucket {
  bucketLabel: '0_TO_24H' | '24H_TO_72H' | 'OVER_72H';
  entryCount: number;
  grossMinor: number;
  netPayableMinor: number;
}

export interface TenantLiquiditySnapshot {
  tenantId: string;
  settlementCurrency: SupportedCurrency;
  pendingExposureMinor: number;
  clearedSettleableMinor: number;
  disputedFrozenMinor: number;
  totalSettledAllTimeMinor: number;
  reserveVaultBalanceMinor: number;
  minimumReserveTargetMinor: number;
  reserveDeficitMinor: number;
  reserveCoverageRatioBps: number;
  agingBuckets: AgingExposureBucket[];
  isReserveHealthy: boolean;
}

export interface ReserveReleaseEvaluation {
  tenantId: string;
  eligibleForReleaseMinor: number;
  lockedByOpenDisputesMinor: number;
  lockedByMinimumTargetMinor: number;
  canReleaseNow: boolean;
}

export class LiquidityForecastService {
  constructor(
    private readonly store: ClearingJournalStore,
    private readonly registry: TenantPolicyRegistry,
  ) {}

  public computeTenantLiquidity(
    tenantId: string,
    nowMs = Date.now(),
  ): TenantLiquiditySnapshot {
    const tenant = this.registry.getTenant(tenantId);
    if (!tenant) {
      throw new ClearingError(
        `Tenant '${tenantId}' not found`,
        404,
        'TENANT_NOT_FOUND',
      );
    }

    const entries = this.store.listEntriesByTenant(tenant.tenantId);

    let pendingExposureMinor = 0;
    let clearedSettleableMinor = 0;
    let disputedFrozenMinor = 0;
    let totalSettledAllTimeMinor = 0;

    const bucket0To24: AgingExposureBucket = {
      bucketLabel: '0_TO_24H',
      entryCount: 0,
      grossMinor: 0,
      netPayableMinor: 0,
    };
    const bucket24To72: AgingExposureBucket = {
      bucketLabel: '24H_TO_72H',
      entryCount: 0,
      grossMinor: 0,
      netPayableMinor: 0,
    };
    const bucketOver72: AgingExposureBucket = {
      bucketLabel: 'OVER_72H',
      entryCount: 0,
      grossMinor: 0,
      netPayableMinor: 0,
    };

    for (const entry of entries) {
      const remainingNet = Math.max(
        0,
        entry.netMerchantPayableMinor - entry.refundedMinor,
      );

      if (entry.status === 'PENDING') {
        pendingExposureMinor += remainingNet;
      } else if (
        entry.status === 'CLEARED' ||
        entry.status === 'PARTIALLY_REFUNDED'
      ) {
        clearedSettleableMinor += remainingNet;
        this.classifyIntoAgingBucket(
          entry,
          remainingNet,
          nowMs,
          bucket0To24,
          bucket24To72,
          bucketOver72,
        );
      } else if (entry.status === 'DISPUTED') {
        disputedFrozenMinor += entry.grossSettlementMinor - entry.refundedMinor;
      } else if (entry.status === 'SETTLED') {
        totalSettledAllTimeMinor += remainingNet;
      }
    }

    const reserveDeficitMinor = Math.max(
      0,
      tenant.minimumReserveTargetMinor - tenant.reserveVaultBalanceMinor,
    );

    const activeExposure =
      pendingExposureMinor + clearedSettleableMinor + disputedFrozenMinor;

    const reserveCoverageRatioBps =
      activeExposure > 0
        ? Math.round((tenant.reserveVaultBalanceMinor / activeExposure) * 10000)
        : 10000;

    return {
      tenantId: tenant.tenantId,
      settlementCurrency: tenant.settlementCurrency,
      pendingExposureMinor,
      clearedSettleableMinor,
      disputedFrozenMinor,
      totalSettledAllTimeMinor,
      reserveVaultBalanceMinor: tenant.reserveVaultBalanceMinor,
      minimumReserveTargetMinor: tenant.minimumReserveTargetMinor,
      reserveDeficitMinor,
      reserveCoverageRatioBps,
      agingBuckets: [bucket0To24, bucket24To72, bucketOver72],
      isReserveHealthy:
        reserveDeficitMinor === 0 && disputedFrozenMinor <= tenant.reserveVaultBalanceMinor,
    };
  }

  public evaluateReserveRelease(tenantId: string): ReserveReleaseEvaluation {
    const tenant = this.registry.assertActiveTenant(tenantId);
    const db = this.store.readAll();
    const openDisputes = db.disputes.filter(
      (d) => d.tenantId === tenant.tenantId && d.status === 'OPEN',
    );

    const lockedByOpenDisputesMinor = openDisputes.reduce(
      (sum, d) => sum + d.disputedMinor,
      0,
    );

    const lockedByMinimumTargetMinor = tenant.minimumReserveTargetMinor;
    const totalProtected = Math.max(
      lockedByMinimumTargetMinor,
      lockedByOpenDisputesMinor,
    );

    const eligibleForReleaseMinor = Math.max(
      0,
      tenant.reserveVaultBalanceMinor - totalProtected,
    );

    return {
      tenantId: tenant.tenantId,
      eligibleForReleaseMinor,
      lockedByOpenDisputesMinor,
      lockedByMinimumTargetMinor,
      canReleaseNow: eligibleForReleaseMinor > 0 && openDisputes.length === 0,
    };
  }

  private classifyIntoAgingBucket(
    entry: ClearingLedgerEntry,
    remainingNet: number,
    nowMs: number,
    b0: AgingExposureBucket,
    b1: AgingExposureBucket,
    b2: AgingExposureBucket,
  ): void {
    const createdMs = Date.parse(entry.createdAt);
    const ageHours = Number.isNaN(createdMs)
      ? 0
      : Math.max(0, (nowMs - createdMs) / (1000 * 60 * 60));

    const target = ageHours <= 24 ? b0 : ageHours <= 72 ? b1 : b2;
    target.entryCount += 1;
    target.grossMinor += entry.grossSettlementMinor;
    target.netPayableMinor += remainingNet;
  }
}