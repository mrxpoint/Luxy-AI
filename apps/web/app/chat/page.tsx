'use client';

import { useEffect, useRef, useState } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Explain the current risk limits.',
  'What happens when the drawdown kill switch trips?',
  'How does the E2B backtest gate entries?',
  'Summarize the screener scoring rules.',
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        "Hi — I'm Luxy. I turn screener signals into validated trading intents, and a hardcoded risk layer gets the final say on everything. Ask me anything about the system.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setInput('');
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setMessages((m) => [...m, { role: 'assistant', content: data.reply ?? data.error ?? 'no reply' }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `Request failed: ${err instanceof Error ? err.message : 'unknown'}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Chat with Luxy</h1>
        <p className="mt-1 font-mono text-xs text-ink/60">
          conversational mode — trade proposals here are informational; only queue intents execute.
        </p>
      </div>

      <div
        ref={listRef}
        className="brutal-card flex h-[480px] flex-col gap-3 overflow-y-auto p-4"
        role="log"
        aria-label="Chat messages"
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] border-2 border-ink px-3 py-2 shadow-brutal-sm ${
                m.role === 'user' ? 'bg-coralSoft' : 'bg-mintSoft'
              }`}
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink/50">
                {m.role === 'user' ? 'you' : 'luxy'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex justify-start" aria-live="polite">
            <div className="brutal-badge bg-butterSoft animate-pulse">luxy is thinking…</div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} disabled={busy} className="brutal-btn-ghost text-xs">
            {s}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message to Luxy
        </label>
        <input
          id="chat-input"
          className="brutal-input flex-1"
          placeholder="Ask about signals, risk, strategy…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
        <button type="submit" className="brutal-btn-primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
