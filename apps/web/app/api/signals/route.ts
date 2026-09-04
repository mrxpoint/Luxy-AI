import { NextResponse } from 'next/server';
import { getSignals } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
  const data = await getSignals(limit, offset);
  return NextResponse.json(data);
}
