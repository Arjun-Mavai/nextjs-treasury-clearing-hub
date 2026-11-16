import fs from 'fs';
import path from 'path';
import { ClearingEntryStatus } from '../clearing/clearing-state-machine';
import {
  JournalPostingLine,
  SupportedCurrency,
} from '../math/minor-unit-ledger';
import { ComplianceAuditRecord } from '../audit/compliance-redactor';

export interface ClearingLedgerEntry {
  entryId: string;
  tenantId: string;
  idempotencyKey: string;
  externalOrderId: string;
  version: number;
  sourceAmountMinor: number;
  sourceCurrency: SupportedCurrency;
  settlementCurrency: SupportedCurrency;    
  fxEffectiveRate: number;
  fxSpreadCostMinor: number;        
  grossSettlementMinor: number;
  commissionMinor: number;
  gstOnCommissionMinor: number;
  tdsWithheldMinor: number;
  rollingReserveMinor: number;
  netMerchantPayableMinor: number;
  refundedMinor: number;
  customerEmail: string;
  payloadHash?: string;
  status: ClearingEntryStatus;
  batchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChargebackDisputeCase {
  disputeId: string;
  entryId: string;
  tenantId: string;
  reasonCode: string;
  disputedMinor: number;
  clawedBackFromReserveMinor: number;
  status: 'OPEN' | 'WON_MERCHANT' | 'LOST_CUSTOMER';
  openedAt: string;
  closedAt?: string;
}

export interface SettlementBatchEntity {
  batchId: string;
  tenantId: string;
  entryIds: string[];
  currency: SupportedCurrency;
  totalGrossMinor: number;
  totalCommissionMinor: number;
  totalGstMinor: number;
  totalTdsMinor: number;
  totalReserveHeldMinor: number;
  totalNetPayoutMinor: number;
  payoutBankMasked: string;
  createdAt: string;
}

export interface ClearingJournalDatabase {
  entries: ClearingLedgerEntry[];
  journalLines: JournalPostingLine[];
  disputes: ChargebackDisputeCase[];
  batches: SettlementBatchEntity[];
  auditLogs: ComplianceAuditRecord[];
}

export class ClearingJournalStore {
  private readonly filePath: string;

  constructor(customPath?: string) {
    this.filePath =
      customPath ||
      process.env.CLEARING_JOURNAL_PATH ||
      path.join(process.cwd(), 'data', 'clearing-journal.json');
  }

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      const empty: ClearingJournalDatabase = {
        entries: [],
        journalLines: [],
        disputes: [],
        batches: [],
        auditLogs: [],
      };
      fs.writeFileSync(this.filePath, JSON.stringify(empty, null, 2), 'utf-8');
    }
  }

  public readAll(): ClearingJournalDatabase {
    this.ensureFile();
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ClearingJournalDatabase>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      journalLines: Array.isArray(parsed.journalLines)
        ? parsed.journalLines
        : [],
      disputes: Array.isArray(parsed.disputes) ? parsed.disputes : [],
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
    };
  }

  public writeAll(db: ClearingJournalDatabase): void {
    this.ensureFile();
    fs.writeFileSync(this.filePath, JSON.stringify(db, null, 2), 'utf-8');
  }

  public reset(): void {
    this.writeAll({
      entries: [],
      journalLines: [],
      disputes: [],
      batches: [],
      auditLogs: [],
    });
  }

  public findEntryById(entryId: string): ClearingLedgerEntry | undefined {
    return this.readAll().entries.find((e) => e.entryId === entryId);
  }

  public findEntryByIdempotencyKey(
    tenantId: string,
    normalizedKey: string,
  ): ClearingLedgerEntry | undefined {
    return this.readAll().entries.find(
      (e) =>
        e.tenantId.trim().toLowerCase() === tenantId.trim().toLowerCase() &&
        e.idempotencyKey.trim().toLowerCase() === normalizedKey,
    );
  }

  public saveEntry(entry: ClearingLedgerEntry): ClearingLedgerEntry {
    const db = this.readAll();
    const idx = db.entries.findIndex((e) => e.entryId === entry.entryId);
    if (idx >= 0) {
      db.entries[idx] = entry;
    } else {
      db.entries.push(entry);
    }
    this.writeAll(db);
    return entry;
  }

  public appendJournalLines(lines: JournalPostingLine[]): void {
    if (lines.length === 0) return;
    const db = this.readAll();
    db.journalLines.push(...lines);
    this.writeAll(db);
  }

  public listEntriesByTenant(tenantId: string): ClearingLedgerEntry[] {
    const norm = tenantId.trim().toLowerCase();
    return this.readAll().entries.filter(
      (e) => e.tenantId.trim().toLowerCase() === norm,
    );
  }

  public listJournalLinesByTenant(tenantId: string): JournalPostingLine[] {
    const norm = tenantId.trim().toLowerCase();
    return this.readAll().journalLines.filter(
      (l) => l.tenantId.trim().toLowerCase() === norm,
    );
  }

  public saveDispute(dispute: ChargebackDisputeCase): ChargebackDisputeCase {
    const db = this.readAll();
    const idx = db.disputes.findIndex((d) => d.disputeId === dispute.disputeId);
    if (idx >= 0) {
      db.disputes[idx] = dispute;
    } else {
      db.disputes.push(dispute);
    }
    this.writeAll(db);
    return dispute;
  }

  public findOpenDisputesForEntry(entryId: string): ChargebackDisputeCase[] {
    return this.readAll().disputes.filter(
      (d) => d.entryId === entryId && d.status === 'OPEN',
    );
  }

  public saveBatch(batch: SettlementBatchEntity): SettlementBatchEntity {
    const db = this.readAll();
    db.batches.push(batch);
    this.writeAll(db);
    return batch;
  }

  public listBatchesByTenant(tenantId: string): SettlementBatchEntity[] {
    const norm = tenantId.trim().toLowerCase();
    return this.readAll().batches.filter(
      (b) => b.tenantId.trim().toLowerCase() === norm,
    );
  }

  public appendAudit(record: ComplianceAuditRecord): void {
    const db = this.readAll();
    db.auditLogs.push(record);
    this.writeAll(db);
  }

  public listAuditsByTenant(tenantId: string): ComplianceAuditRecord[] {
    const norm = tenantId.trim().toLowerCase();
    return this.readAll().auditLogs.filter(
      (a) => a.tenantId.trim().toLowerCase() === norm,
    );
  }
}

export type ClearingJournalEntry = ClearingLedgerEntry;