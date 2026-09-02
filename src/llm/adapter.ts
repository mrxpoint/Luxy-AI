/**
 * Provider-agnostic LLM adapter (BLUEPRINT.md §3.3).
 *
 * All LLM traffic in the system goes through this single interface.
 * Switching providers (or to the future self-hosted fine-tuned model) is a
 * config change, never a code change.
 *
 * Implemented over plain fetch — no vendor SDKs — so the same adapter works
 * for anthropic, openai-compatible (openai/openrouter/local vLLM).
 */
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'llm' });

export type LLMProvider = 'anthropic' | 'openai' | 'openrouter' | 'local';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMAdapter {
  readonly provider: LLMProvider;
  readonly model: string;
  chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse>;
}

const TIMEOUT_MS = 60_000;

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------
function anthropicAdapter(apiKey: string, model: string): LLMAdapter {
  return {
    provider: 'anthropic',
    model,
    async chat(messages, systemPrompt) {
      const { signal, clear } = withTimeout(TIMEOUT_MS);
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`anthropic api ${res.status}: ${body.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens: number; output_tokens: number };
          model: string;
        };
        const text = data.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('');
        return {
          text,
          model: data.model,
          inputTokens: data.usage?.input_tokens,
          outputTokens: data.usage?.output_tokens,
        };
      } finally {
        clear();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible Chat Completions (openai | openrouter | local vLLM/Ollama)
// ---------------------------------------------------------------------------
function openAICompatibleAdapter(
  provider: LLMProvider,
  apiKey: string,
  model: string,
  baseUrl: string,
): LLMAdapter {
  const url =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    provider,
    model,
    async chat(messages, systemPrompt) {
      const { signal, clear } = withTimeout(TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            ...(provider === 'openrouter'
              ? { 'http-referer': 'https://github.com/mrxpoint/Luxy-AI', 'x-title': 'Luxy AI' }
              : {}),
          },
          body: JSON.stringify({
            model,
            messages: [
              ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
              ...messages,
            ],
            temperature: 0.3,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${provider} api ${res.status}: ${body.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          choices: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
          model?: string;
        };
        return {
          text: data.choices[0]?.message?.content ?? '',
          model: data.model ?? model,
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens,
        };
      } finally {
        clear();
      }
    },
  };
}

/** Build an adapter from explicit provider settings. */
export function buildAdapter(
  provider: LLMProvider,
  apiKey: string,
  model: string,
  baseUrl?: string,
): LLMAdapter {
  switch (provider) {
    case 'anthropic':
      return anthropicAdapter(apiKey, model);
    case 'openai':
    case 'openrouter':
    case 'local':
      return openAICompatibleAdapter(provider, apiKey, model, baseUrl ?? '');
  }
}

/** Tier-1 adapter: Luxy core decisions. */
export function luxyLLM(): LLMAdapter {
  return buildAdapter(
    config.LUXY_LLM_PROVIDER,
    config.LUXY_LLM_API_KEY,
    config.LUXY_LLM_MODEL,
    config.LUXY_LLM_BASE_URL,
  );
}

/** Tier-2 adapter: sub-agent high-volume calls (screener filter, hype, LP confirm). */
export function subagentLLM(): LLMAdapter {
  return buildAdapter(
    config.SUBAGENT_LLM_PROVIDER,
    config.SUBAGENT_LLM_API_KEY,
    config.SUBAGENT_LLM_MODEL,
  );
}

/** True when the given adapter has usable credentials. */
export function isConfigured(a: LLMAdapter): boolean {
  if (a.provider === 'local') return true;
  if (a.provider === 'anthropic') return a.model.startsWith('claude');
  return true;
}

/** Safe chat wrapper: returns null instead of throwing (callers must degrade gracefully). */
export async function tryChat(
  adapter: LLMAdapter,
  messages: LLMMessage[],
  systemPrompt?: string,
): Promise<LLMResponse | null> {
  try {
    return await adapter.chat(messages, systemPrompt);
  } catch (err) {
    log.warn({ err, provider: adapter.provider, model: adapter.model }, 'llm call failed');
    return null;
  }
}
