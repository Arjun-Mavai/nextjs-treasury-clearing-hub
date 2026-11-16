import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { isClearingError } from '@/lib/errors/clearing-error';
import { getClearingEngine } from '@/lib/store/engine-singleton';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  try {
    const { tenantId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      entryIds?: string[];
    };
    const { batcher } = getClearingEngine();
    const batch = batcher.createSettlementBatch({
      tenantId,
      entryIds: body.entryIds,
    });
    return NextResponse.json({ batch }, { status: 201 });
  } catch (err) {
    if (isClearingError(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    const errorId = crypto.randomUUID();
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR', errorId },
      { status: 500 },
    );
  }
}