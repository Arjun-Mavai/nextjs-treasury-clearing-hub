import { ClearingIngestionService } from '../clearing/clearing-ingestion.service';
import { ChargebackClawbackService } from '../disputes/chargeback-clawback';
import { FxRateEngine } from '../fx/fx-rate-engine';
import { TenantPolicyRegistry } from '../merchants/tier-policy';
import { StatementMatcherService } from '../reconciliation/statement-matcher';
import { SettlementBatcherService } from '../settlements/settlement-batcher';
import { MultiVendorSplitterService } from '../splits/multi-vendor-splitter';
import { LiquidityForecastService } from '../treasury/liquidity-forecast.service';
import { OutboundWebhookDispatcher } from '../webhooks/outbound-dispatcher';
import { ClearingJournalStore } from './journal-store';

export interface ClearingEngineContainer {
  store: ClearingJournalStore;
  registry: TenantPolicyRegistry;
  fxEngine: FxRateEngine;
  ingestion: ClearingIngestionService;
  disputes: ChargebackClawbackService;
  batcher: SettlementBatcherService;
  reconciler: StatementMatcherService;
  splitter: MultiVendorSplitterService;
  liquidity: LiquidityForecastService;
  webhooks: OutboundWebhookDispatcher;
}

let singleton: ClearingEngineContainer | null = null;

export function getClearingEngine(): ClearingEngineContainer {
  if (!singleton) {
    const store = new ClearingJournalStore();
    const registry = new TenantPolicyRegistry();
    const fxEngine = new FxRateEngine();
    const ingestion = new ClearingIngestionService(store, registry, fxEngine);
    const disputes = new ChargebackClawbackService(store, registry);
    const batcher = new SettlementBatcherService(store, registry);
    const reconciler = new StatementMatcherService(store, registry);
    const splitter = new MultiVendorSplitterService();
    const liquidity = new LiquidityForecastService(store, registry);
    const webhooks = new OutboundWebhookDispatcher();

    singleton = {
      store,
      registry,
      fxEngine,
      ingestion,
      disputes,
      batcher,
      reconciler,
      splitter,
      liquidity,
      webhooks,
    };
  }
  return singleton;
}