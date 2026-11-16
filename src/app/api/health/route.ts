import { NextResponse } from 'next/server';
import { getClearingEngine } from '@/lib/store/engine-singleton';

export async function GET(): Promise<NextResponse> {
  const { registry } = getClearingEngine();
  return NextResponse.json(
    {
      status: 'ok',
      service: 'nextjs-treasury-clearing-hub',
      activeTenants: registry.listAllTenants().length,
    },
    { status: 200 },
  );
}