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
    const body = (await req.json()) as {
      action?: 'OPEN' | 'RESOLVE';
      entryId?: string;
      reasonCode?: string;
      disputedMinor?: number;
      disputeId?: string;
      outcome?: 'WON_MERCHANT' | 'LOST_CUSTOMER';
    };

    const { disputes } = getClearingEngine();
    if (body.action === 'RESOLVE') {
      const resolved = disputes.resolveChargeback({
        tenantId,
        disputeId: body.disputeId ?? '',
        outcome: body.outcome ?? 'WON_MERCHANT',
      });
      return NextResponse.json({ dispute: resolved }, { status: 200 });
    }

    const opened = disputes.openChargeback({
      tenantId,
      entryId: body.entryId ?? '',
      reasonCode: body.reasonCode ?? 'CHARGEBACK',
      disputedMinor: body.disputedMinor,
    });
    return NextResponse.json({ dispute: opened }, { status: 201 });
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