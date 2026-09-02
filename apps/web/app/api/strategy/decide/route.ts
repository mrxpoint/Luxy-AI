import { NextResponse } from 'next/server';
import { decideProposal } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Strategy proposal decision endpoint (BLUEPRINT §5.3).
 * POST { id: number, decision: "approve" | "reject" }
 */
export async function POST(request: Request) {
  let body: { id?: unknown; decision?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'invalid JSON body' }, { status: 400 });
  }

  const id = Number(body.id);
  const decision = body.decision;
  if (!Number.isInteger(id)) {
    return NextResponse.json({ ok: false, message: 'id must be an integer' }, { status: 400 });
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json(
      { ok: false, message: 'decision must be "approve" or "reject"' },
      { status: 400 },
    );
  }

  const result = await decideProposal(id, decision);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
