import { NextRequest, NextResponse } from 'next/server';
import { isClearingError } from '@/lib/errors/clearing-error';
import { assertJournalBalanced } from '@/lib/math/minor-unit-ledger';
import { SplitRecipientRule } from '@/lib/splits/multi-vendor-splitter';
import { getClearingEngine } from '@/lib/store/engine-singleton';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  try {
    const { tenantId } = await context.params;
    const body = (await req.json()) as {
      entryId?: string;
      rules?: SplitRecipientRule[];
    };

    const { registry, store, splitter } = getClearingEngine();
    const tenant = registry.assertActiveTenant(tenantId);
    const entry = store.findEntryById(body.entryId ?? '');

    if (!entry || entry.tenantId !== tenant.tenantId) {
      return NextResponse.json(
        { error: 'Clearing entry not found', code: 'ENTRY_NOT_FOUND' },
        { status: 404 },
      );
    }

    const plan = splitter.computeSplitPlan({
      entryId: entry.entryId,
      tenantId: tenant.tenantId,
      netDistributableMinor: entry.netMerchantPayableMinor,
      currency: entry.settlementCurrency,
      rules: body.rules ?? [],
    });

    const lines = splitter.buildSplitJournalLines(plan);
    assertJournalBalanced(lines, entry.settlementCurrency);
    store.appendJournalLines(lines);

    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    if (isClearingError(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}