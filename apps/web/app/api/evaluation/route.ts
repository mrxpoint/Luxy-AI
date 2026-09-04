import { NextResponse } from 'next/server';
import { getEvaluation } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getEvaluation();
  return NextResponse.json(data);
}
