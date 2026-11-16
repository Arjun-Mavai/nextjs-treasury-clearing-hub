import { NextRequest, NextResponse } from 'next/server';
import { isClearingError } from '@/lib/errors/clearing-error';
import { getClearingEngine } from '@/lib/store/engine-singleton';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  try {
    const { tenantId } = await context.params;
    const { liquidity, store } = getClearingEngine();
    const snapshot = liquidity.computeTenantLiquidity(tenantId);
    const release = liquidity.evaluateReserveRelease(tenantId);
    const journalLines = store.listJournalLinesByTenant(tenantId);

    return NextResponse.json(
      {
        snapshot,
        release,
        journalLineCount: journalLines.length,
        journalLines,
      },
      { status: 200 },
    );
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