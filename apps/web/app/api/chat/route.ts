/**
 * POST /api/chat — forwards a user message to the Luxy agent LLM
 * (server-side only; keys never reach the browser).
 *
 * Provider logic mirrors src/llm/adapter.ts (kept dependency-free so the
 * web app does not import the backend runtime). When no API key is set the
 * route answers with an honest "not configured" reply — never a fake
 * trading decision.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM = `You are Luxy — an autonomous AI trading agent's conversational interface.
Be concise, concrete, and honest. You propose intents but never execute; a hardcoded
risk layer (3% max position, 8% daily drawdown kill switch, 2% slippage, 5 max
positions) gates everything downstream. The system runs in dry-run mode by default.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(request: Request) {
  let body: { messages?: ChatMessage[] };
  try {
    body = (await request.json()) as { messages?: ChatMessage[] };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const messages = (body.messages ?? []).slice(-12);
  if (messages.length === 0 || !messages[messages.length - 1]?.content?.trim()) {
    return NextResponse.json({ error: 'empty message' }, { status: 400 });
  }

  const provider = process.env.LUXY_LLM_PROVIDER ?? 'anthropic';
  const apiKey =
    provider === 'anthropic'
      ? (process.env.LUXY_LLM_API_KEY ?? '')
      : provider === 'openrouter'
        ? (process.env.SUBAGENT_LLM_API_KEY ?? '')
        : (process.env.LUXY_LLM_API_KEY ?? '');

  if (!apiKey) {
    return NextResponse.json({
      reply:
        "LLM is not configured yet — I can't reason about trades without it.\n\n" +
        'To enable me: set LUXY_LLM_PROVIDER + LUXY_LLM_API_KEY in `.env`, then restart the web app.\n' +
        'Everything else (screener, executor, risk guard, queues) runs fine in dry-run without it.',
    });
  }

  try {
    const text = await callLLM(provider, apiKey, messages);
    return NextResponse.json({ reply: text });
  } catch (err) {
    return NextResponse.json(
      { reply: `LLM call failed: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 502 },
    );
  }
}

async function callLLM(
  provider: string,
  apiKey: string,
  messages: ChatMessage[],
): Promise<string> {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.LUXY_LLM_MODEL ?? 'claude-sonnet-5',
        max_tokens: 1024,
        system: SYSTEM,
        messages,
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = (await res.json()) as { content: Array<{ text?: string }> };
    return data.content.map((c) => c.text ?? '').join('');
  }

  const url =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : `${(process.env.LUXY_LLM_BASE_URL ?? 'http://localhost:8000/v1').replace(/\/$/, '')}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:
        process.env.LUXY_LLM_MODEL ??
        (provider === 'openrouter' ? 'deepseek/deepseek-chat-v3-0324' : 'gpt-4o-mini'),
      messages: [{ role: 'system', content: SYSTEM }, ...messages],
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}`);
  const data = (await res.json()) as { choices: Array<{ message?: { content?: string } }> };
  return data.choices[0]?.message?.content ?? '';
}
