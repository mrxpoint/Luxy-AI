import { NextResponse } from 'next/server';
import { getPositions } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);
  const data = await getPositions(limit);
  return NextResponse.json(data);
}
