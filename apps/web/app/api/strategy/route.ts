import { NextResponse } from 'next/server';
import { getStrategy } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getStrategy();
  return NextResponse.json(data);
}
