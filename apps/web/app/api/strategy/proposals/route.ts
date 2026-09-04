import { NextResponse } from 'next/server';
import { getProposals } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getProposals();
  return NextResponse.json(data);
}
