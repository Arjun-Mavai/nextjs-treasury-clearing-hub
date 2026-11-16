import {
  assertPositiveMinorUnit,
  bankersRound,
  halfUpRound,
  SupportedCurrency,
} from '../math/minor-unit-ledger';
import { TierFeeSchedule } from '../merchants/tier-policy';

export interface ClearingDeductionBreakdown {
  grossSettlementMinor: number;
  commissionMinor: number;
  gstOnCommissionMinor: number;
  tdsWithheldMinor: number;
  rollingReserveMinor: number;
  netMerchantPayableMinor: number;
  currency: SupportedCurrency;
}

/**
 * Calculates platform commission, 18% GST on commission, 1% TDS on gross,
 * and rolling reserve holdback in minor units.
 *
 * INTENTIONAL COMPLEX BUGS FOR TASK 1:
 * 1. Mixes halfUpRound() for commission/GST with bankersRound() for TDS/reserve.
 * 2. When grossSettlementMinor is tiny (e.g. 5 minor units), deductions can exceed
 *    gross and produce a negative netMerchantPayableMinor!
 */
export function calculateClearingDeductions(params: {
  grossSettlementMinor: number;
  schedule: TierFeeSchedule;
  currency: SupportedCurrency;
  waiveReserve?: boolean;
}): ClearingDeductionBreakdown {
  const {
    grossSettlementMinor,
    schedule,
    currency,
    waiveReserve = false,
  } = params;

  assertPositiveMinorUnit(grossSettlementMinor, 'grossSettlementMinor');

  const commissionExact =
    (grossSettlementMinor * schedule.baseCommissionBps) / 10000;
  const commissionMinor = halfUpRound(commissionExact);

  const gstExact = (commissionMinor * schedule.gstOnCommissionBps) / 10000;
  const gstOnCommissionMinor = halfUpRound(gstExact);

  const tdsExact = (grossSettlementMinor * schedule.tdsWithholdingBps) / 10000;
  const tdsWithheldMinor = bankersRound(tdsExact);

  const reserveExact = waiveReserve
    ? 0
    : (grossSettlementMinor * schedule.rollingReserveBps) / 10000;
  const rollingReserveMinor = bankersRound(reserveExact);

  const totalDeductions =
    commissionMinor +
    gstOnCommissionMinor +
    tdsWithheldMinor +
    rollingReserveMinor;

  const netMerchantPayableMinor = grossSettlementMinor - totalDeductions;

  return {
    grossSettlementMinor,
    commissionMinor,
    gstOnCommissionMinor,
    tdsWithheldMinor,
    rollingReserveMinor,
    netMerchantPayableMinor,
    currency,
  };
}

export function verifyDeductionConservation(
  b: ClearingDeductionBreakdown,
): boolean {
  const sum =
    b.commissionMinor +
    b.gstOnCommissionMinor +
    b.tdsWithheldMinor +
    b.rollingReserveMinor +
    b.netMerchantPayableMinor;
  return sum === b.grossSettlementMinor && b.netMerchantPayableMinor >= 0;
}