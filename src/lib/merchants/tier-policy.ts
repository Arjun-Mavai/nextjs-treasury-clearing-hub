import { ClearingError } from '../errors/clearing-error';
import { SupportedCurrency } from '../math/minor-unit-ledger';

export type MerchantTier = 'STARTER' | 'GROWTH' | 'ENTERPRISE';
export type TenantLifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'ONBOARDING';

export interface TierFeeSchedule {
  tier: MerchantTier;
  baseCommissionBps: number;
  gstOnCommissionBps: number; // 1800 = 18.00%
  tdsWithholdingBps: number; // 100 = 1.00%
  rollingReserveBps: number; // 500 = 5.00%
  fxSpreadBps: number;
}

export interface TenantClearingProfile {
  tenantId: string;
  legalName: string;
  status: TenantLifecycleStatus;
  tier: MerchantTier;
  settlementCurrency: SupportedCurrency;
  allowedSourceCurrencies: SupportedCurrency[];
  customCommissionBps?: number;
  reserveVaultBalanceMinor: number;
  minimumReserveTargetMinor: number;
  payoutBankAccount: string;
  taxPanNumber: string;
  complianceEmail: string;
}

export const TIER_SCHEDULES: Record<MerchantTier, TierFeeSchedule> = {
  STARTER: {
    tier: 'STARTER',
    baseCommissionBps: 275, // 2.75%
    gstOnCommissionBps: 1800,
    tdsWithholdingBps: 100,
    rollingReserveBps: 500,
    fxSpreadBps: 75,
  },
  GROWTH: {
    tier: 'GROWTH',
    baseCommissionBps: 185, // 1.85%
    gstOnCommissionBps: 1800,
    tdsWithholdingBps: 100,
    rollingReserveBps: 250,
    fxSpreadBps: 45,
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    baseCommissionBps: 115, // 1.15%
    gstOnCommissionBps: 1800,
    tdsWithholdingBps: 100,
    rollingReserveBps: 100,
    fxSpreadBps: 20,
  },
};

const SEED_TENANTS: TenantClearingProfile[] = [
  {
    tenantId: 'mock_tenant_alpha',
    legalName: 'mock_user_alpha',
    status: 'ACTIVE',
    tier: 'GROWTH',
    settlementCurrency: 'INR',
    allowedSourceCurrencies: ['INR', 'USD', 'EUR'],
    reserveVaultBalanceMinor: 250_000,
    minimumReserveTargetMinor: 500_000,
    payoutBankAccount: 'mock_acct_001',
    taxPanNumber: 'mock_tax_pan_001',
    complianceEmail: 'dummy@internal.mock',
  },
  {
    tenantId: 'mock_tenant_beta',
    legalName: 'mock_user_beta',
    status: 'ACTIVE',
    tier: 'STARTER',
    settlementCurrency: 'INR',
    allowedSourceCurrencies: ['INR', 'USD'],
    reserveVaultBalanceMinor: 50_000,
    minimumReserveTargetMinor: 200_000,
    payoutBankAccount: 'mock_acct_002',
    taxPanNumber: 'mock_tax_pan_002',
    complianceEmail: 'dummy@internal.mock',
  },
  {
    tenantId: 'mock_tenant_gamma',
    legalName: 'mock_user_gamma',
    status: 'ACTIVE',
    tier: 'ENTERPRISE',
    settlementCurrency: 'EUR',
    allowedSourceCurrencies: ['EUR', 'USD', 'GBP'],
    reserveVaultBalanceMinor: 1_000_000,
    minimumReserveTargetMinor: 1_000_000,
    payoutBankAccount: 'fake_iban_9999',
    taxPanNumber: 'mock_tax_pan_003',
    complianceEmail: 'dummy@internal.mock',
  },
  {
    tenantId: 'mock_tenant_delta',
    legalName: 'mock_user_delta',
    status: 'SUSPENDED',
    tier: 'STARTER',
    settlementCurrency: 'INR',
    allowedSourceCurrencies: ['INR'],
    reserveVaultBalanceMinor: 10_000,
    minimumReserveTargetMinor: 100_000,
    payoutBankAccount: 'mock_acct_003',
    taxPanNumber: 'mock_tax_pan_004',
    complianceEmail: 'dummy@internal.mock',
  },
];

export class TenantPolicyRegistry {
  private profiles: Map<string, TenantClearingProfile> = new Map();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.profiles.clear();
    for (const seed of SEED_TENANTS) {
      this.profiles.set(seed.tenantId, {
        ...seed,
        allowedSourceCurrencies: [...seed.allowedSourceCurrencies],
      });
    }
  }

  public normalizeTenantId(raw: string): string {
    return raw.trim().toLowerCase();
  }

  public registerTenant(
    profile: TenantClearingProfile,
  ): TenantClearingProfile {
    const id = this.normalizeTenantId(profile.tenantId);
    if (!id) {
      throw new ClearingError(
        'tenantId cannot be blank',
        400,
        'INVALID_PAYLOAD',
      );
    }
    const stored: TenantClearingProfile = {
      ...profile,
      tenantId: id,
      allowedSourceCurrencies: [...profile.allowedSourceCurrencies],
    };
    this.profiles.set(id, stored);
    return stored;
  }

  /**
   * BUG: Only trims whitespace without lowercasing on lookup, causing uppercase
   * tenant IDs like "MOCK_TENANT_ALPHA" to fail with undefined.
   */
  public getTenant(tenantId: string): TenantClearingProfile | undefined {
    return this.profiles.get(tenantId.trim());
  }

  public assertActiveTenant(tenantId: string): TenantClearingProfile {
    const tenant = this.getTenant(tenantId);
    if (!tenant) {
      throw new ClearingError(
        `Tenant '${tenantId}' does not exist`,
        404,
        'TENANT_NOT_FOUND',
      );
    }
    if (tenant.status !== 'ACTIVE') {
      throw new ClearingError(
        `Tenant '${tenant.tenantId}' is ${tenant.status}`,
        403,
        'TENANT_SUSPENDED',
      );
    }
    return tenant;
  }

  public getEffectiveFeeSchedule(
    tenant: TenantClearingProfile,
  ): TierFeeSchedule {
    const base = TIER_SCHEDULES[tenant.tier];
    return {
      ...base,
      baseCommissionBps:
        tenant.customCommissionBps !== undefined
          ? tenant.customCommissionBps
          : base.baseCommissionBps,
    };
  }

  public adjustReserveVaultBalance(
    tenantId: string,
    deltaMinor: number,
  ): TenantClearingProfile {
    const tenant = this.getTenant(tenantId);
    if (!tenant) {
      throw new ClearingError(
        `Tenant '${tenantId}' not found`,
        404,
        'TENANT_NOT_FOUND',
      );
    }
    const nextBalance = tenant.reserveVaultBalanceMinor + deltaMinor;
    if (nextBalance < 0) {
      throw new ClearingError(
        `Reserve vault underflow for tenant '${tenant.tenantId}': available=${tenant.reserveVaultBalanceMinor}, delta=${deltaMinor}`,
        409,
        'INSUFFICIENT_RESERVE_FOR_CLAWBACK',
      );
    }
    tenant.reserveVaultBalanceMinor = nextBalance;
    this.profiles.set(tenant.tenantId, tenant);
    return tenant;
  }

  public listAllTenants(): TenantClearingProfile[] {
    return Array.from(this.profiles.values());
  }
}