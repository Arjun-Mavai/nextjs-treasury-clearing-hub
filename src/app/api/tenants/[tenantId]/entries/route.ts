import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { isClearingError } from '@/lib/errors/clearing-error';
import { assertValidClearingSignature } from '@/lib/security/hmac-verifier';
import { getClearingEngine } from '@/lib/store/engine-singleton';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  const { tenantId } = await context.params;
  const { store } = getClearingEngine();
  const entries = store.listEntriesByTenant(tenantId);
  return NextResponse.json({ entries }, { status: 200 });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  try {
    const { tenantId } = await context.params;
    const rawBody = await req.text();
    const signature = req.headers.get('x-clearing-signature');
    assertValidClearingSignature(rawBody, signature);

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON body', code: 'INVALID_PAYLOAD' },
        { status: 400 },
      );
    }

    const idempotencyKey = req.headers.get('x-idempotency-key');
    const { ingestion } = getClearingEngine();
    const result = ingestion.ingestEntry({
      tenantId,
      rawIdempotencyKey: idempotencyKey,
      rawBody: parsedBody,
    });

    return NextResponse.json(result, {
      status: result.outcome === 'created' ? 201 : 200,
    });
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