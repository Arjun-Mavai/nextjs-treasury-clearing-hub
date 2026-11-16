import { ClearingError } from '../errors/clearing-error';
import {
  assertPositiveMinorUnit,
  bankersRound,
  SupportedCurrency,
} from '../math/minor-unit-ledger';

export interface FxQuote {
  sourceCurrency: SupportedCurrency;
  targetCurrency: SupportedCurrency;
  midMarketRate: number;
  spreadBps: number;
  effectiveRate: number;
  quotedAt: string;
}

export interface FxConversionResult {
  sourceAmountMinor: number;
  sourceCurrency: SupportedCurrency;
  targetAmountMinor: number;
  targetCurrency: SupportedCurrency;
  effectiveRate: number;
  spreadBps: number;
  fxSpreadCostMinor: number;
}

const USD_BASE_RATES: Record<SupportedCurrency, number> = {
  USD: 1.0,
  INR: 84.25,
  EUR: 0.92,
  GBP: 0.79,
};

export class FxRateEngine {
  private customRates: Map<string, number> = new Map();

  private pairKey(from: SupportedCurrency, to: SupportedCurrency): string {
    return `${from}->${to}`;
  }

  public setOverrideRate(
    from: SupportedCurrency,
    to: SupportedCurrency,
    rate: number,
  ): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new ClearingError(
        'Override FX rate must be positive',
        422,
        'FX_RATE_UNAVAILABLE',
      );
    }
    this.customRates.set(this.pairKey(from, to), rate);
  }

  public clearOverrides(): void {
    this.customRates.clear();
  }

  public getQuote(
    sourceCurrency: SupportedCurrency,
    targetCurrency: SupportedCurrency,
    spreadBps = 50,
  ): FxQuote {
    if (sourceCurrency === targetCurrency) {
      return {
        sourceCurrency,
        targetCurrency,
        midMarketRate: 1,
        spreadBps: 0,
        effectiveRate: 1,
        quotedAt: new Date().toISOString(),
      };
    }

    const override = this.customRates.get(
      this.pairKey(sourceCurrency, targetCurrency),
    );
    let midMarketRate: number;
    if (override !== undefined) {
      midMarketRate = override;
    } else {
      const fromUsd = USD_BASE_RATES[sourceCurrency];
      const toUsd = USD_BASE_RATES[targetCurrency];
      if (!fromUsd || !toUsd) {
        throw new ClearingError(
          `Unsupported FX pair ${sourceCurrency}/${targetCurrency}`,
          422,
          'FX_RATE_UNAVAILABLE',
        );
      }
      midMarketRate = Number((toUsd / fromUsd).toFixed(6));
    }

    const spreadFactor = 1 - spreadBps / 10000;
    const effectiveRate = Number((midMarketRate * spreadFactor).toFixed(6));

    return {
      sourceCurrency,
      targetCurrency,
      midMarketRate,
      spreadBps,
      effectiveRate,
      quotedAt: new Date().toISOString(),
    };
  }

  public convertMinorUnits(params: {
    sourceAmountMinor: number;
    sourceCurrency: SupportedCurrency;
    targetCurrency: SupportedCurrency;
    spreadBps?: number;
  }): FxConversionResult {
    const {
      sourceAmountMinor,
      sourceCurrency,
      targetCurrency,
      spreadBps = 50,
    } = params;

    assertPositiveMinorUnit(sourceAmountMinor, 'sourceAmountMinor');

    const quote = this.getQuote(sourceCurrency, targetCurrency, spreadBps);
    if (sourceCurrency === targetCurrency) {
      return {
        sourceAmountMinor,
        sourceCurrency,
        targetAmountMinor: sourceAmountMinor,
        targetCurrency,
        effectiveRate: 1,
        spreadBps: 0,
        fxSpreadCostMinor: 0,
      };
    }

    const grossTargetExact = sourceAmountMinor * quote.midMarketRate;
    const netTargetExact = sourceAmountMinor * quote.effectiveRate;

    const grossTargetMinor = bankersRound(grossTargetExact);
    const targetAmountMinor = bankersRound(netTargetExact);
    const fxSpreadCostMinor = Math.max(0, grossTargetMinor - targetAmountMinor);

    return {
      sourceAmountMinor,
      sourceCurrency,
      targetAmountMinor,
      targetCurrency,
      effectiveRate: quote.effectiveRate,
      spreadBps: quote.spreadBps,
      fxSpreadCostMinor,
    };
  }
}