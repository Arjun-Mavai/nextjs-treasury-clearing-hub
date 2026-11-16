import { NextRequest, NextResponse } from 'next/server';
import { isClearingError } from '@/lib/errors/clearing-error';
import { getClearingEngine } from '@/lib/store/engine-singleton';
import { GatewayStatementRow } from '@/lib/reconciliation/statement-matcher';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  try {
    const { tenantId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      rows?: GatewayStatementRow[];
    };
    const { reconciler } = getClearingEngine();
    const summary = reconciler.reconcileTenant(tenantId, body.rows ?? []);
    return NextResponse.json({ summary }, { status: 200 });
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