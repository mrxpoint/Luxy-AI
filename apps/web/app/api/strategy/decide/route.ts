import { NextResponse } from 'next/server';
import { decideProposal } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Strategy proposal decision endpoint (BLUEPRINT §5.3).
 * POST { id: number, decision: "approve" | "reject" }
 *
 * AUTH: mutation endpoints require `Authorization: Bearer <LUXY_WEB_TOKEN>`
 * (or `x-web-token` header) when LUXY_WEB_TOKEN is set in the environment.
 * Read-only endpoints stay open for the local dashboard; set the token and
 * never expose port 3000 publicly without a reverse-proxy auth layer.
 */
function authorized(request: Request): boolean {
  const expected = process.env.LUXY_WEB_TOKEN;
  if (!expected) return true; // explicitly unsecured (local-only deployment)
  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : request.headers.get('x-web-token') ?? '';
  return bearer === expected;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  }

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
