import { ClearingError } from '../errors/clearing-error';
import {
  BalancedJournalVerification,
  verifyJournalLinesBalanced,
} from '../math/minor-unit-ledger';
import { TenantPolicyRegistry } from '../merchants/tier-policy';
import { ClearingJournalStore } from '../store/journal-store';

export interface GatewayStatementRow {
  gatewayRef: string;
  externalOrderId: string;
  settledMinor: number;
  currency: string;
}

export interface TenantReconciliationSummary {
  tenantId: string;
  journalVerification: BalancedJournalVerification;
  totalEntries: number;
  settledEntries: number;
  disputedEntries: number;
  reserveVaultBalanceMinor: number;
  matchedOrderIds: string[];
  missingInLedgerRefs: string[];
  amountDriftOrders: Array<{
    externalOrderId: string;
    ledgerGrossMinor: number;
    gatewaySettledMinor: number;
    driftMinor: number;
  }>;
}

export class StatementMatcherService {
  constructor(
    private readonly store: ClearingJournalStore,
    private readonly registry: TenantPolicyRegistry,
  ) {}

  public reconcileTenant(
    tenantId: string,
    gatewayRows: GatewayStatementRow[] = [],
  ): TenantReconciliationSummary {
    const tenant = this.registry.getTenant(tenantId);
    if (!tenant) {
      throw new ClearingError(
        `Tenant '${tenantId}' not found`,
        404,
        'TENANT_NOT_FOUND',
      );
    }

    const entries = this.store.listEntriesByTenant(tenant.tenantId);
    const lines = this.store.listJournalLinesByTenant(tenant.tenantId);
    const journalVerification =
      lines.length > 0
        ? verifyJournalLinesBalanced(lines, tenant.settlementCurrency)
        : {
            isBalanced: true,
            totalDebitsMinor: 0,
            totalCreditsMinor: 0,
            imbalanceMinor: 0,
            currency: tenant.settlementCurrency,
          };

    const byOrder = new Map(entries.map((e) => [e.externalOrderId, e]));
    const matchedOrderIds: string[] = [];
    const missingInLedgerRefs: string[] = [];
    const amountDriftOrders: TenantReconciliationSummary['amountDriftOrders'] =
      [];

    for (const row of gatewayRows) {
      const entry = byOrder.get(row.externalOrderId);
      if (!entry) {
        missingInLedgerRefs.push(row.gatewayRef);
        continue;
      }
      if (entry.grossSettlementMinor !== row.settledMinor) {
        amountDriftOrders.push({
          externalOrderId: row.externalOrderId,
          ledgerGrossMinor: entry.grossSettlementMinor,
          gatewaySettledMinor: row.settledMinor,
          driftMinor: entry.grossSettlementMinor - row.settledMinor,
        });
      } else {
        matchedOrderIds.push(row.externalOrderId);
      }
    }

    return {
      tenantId: tenant.tenantId,
      journalVerification,
      totalEntries: entries.length,
      settledEntries: entries.filter((e) => e.status === 'SETTLED').length,
      disputedEntries: entries.filter((e) => e.status === 'DISPUTED').length,
      reserveVaultBalanceMinor: tenant.reserveVaultBalanceMinor,
      matchedOrderIds,
      missingInLedgerRefs,
      amountDriftOrders,
    };
  }
}