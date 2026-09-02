'use client';

import { useEffect, useState } from 'react';
import { Badge, SectionTitle, EmptyState, OfflineBanner } from '@/components/ui';

interface SignalRow {
  id: number;
  source: string;
  agent: string;
  chain: string;
  symbol: string | null;
  score: number;
  llm_verdict: string | null;
  created_at: string;
}

const PAGE = 25;

export default function SignalsPage() {
  const [rows, setRows] = useState<SignalRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<'all' | 'strong' | 'moderate' | 'weak'>('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/signals?limit=200`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { offline: boolean; rows: SignalRow[] }) => {
        if (alive) {
          setRows(d.rows);
          setOffline(d.offline);
        }
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!rows) {
    return <div className="brutal-card h-64 animate-pulse bg-skySoft/40" aria-busy="true" aria-label="Loading signals" />;
  }

  const filtered = rows.filter((r) => (filter === 'all' ? true : r.llm_verdict === filter));
  const paged = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE) - 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Signals</h1>
          <p className="mt-1 font-mono text-xs text-ink/60">
            screener + narrative output — rule-scored, LLM-filtered, queued to the Luxy agent.
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Filter by verdict">
          {(['all', 'strong', 'moderate', 'weak'] as const).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setPage(0);
              }}
              className={`brutal-btn ${filter === f ? 'bg-butter' : 'bg-paper'} hover:bg-ink hover:text-butter`}
              aria-pressed={filter === f}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {offline ? <OfflineBanner note="database unreachable — showing demo signals." /> : null}

      {paged.length === 0 ? (
        <EmptyState
          title="No signals in this view"
          body="Run the screener process (pnpm dev:screener). Candidates need a rule score ≥ 0.45 and a strong/moderate LLM verdict to land here."
        />
      ) : (
        <div className="brutal-card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>time</th>
                <th>source</th>
                <th>agent</th>
                <th>symbol</th>
                <th>chain</th>
                <th>score</th>
                <th>verdict</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{new Date(s.created_at).toLocaleString()}</td>
                  <td>{s.source}</td>
                  <td>{s.agent}</td>
                  <td className="font-bold">{s.symbol ?? '—'}</td>
                  <td>{s.chain}</td>
                  <td>{Number(s.score).toFixed(2)}</td>
                  <td>
                    {s.llm_verdict ? (
                      <Badge tone={s.llm_verdict === 'strong' ? 'mint' : s.llm_verdict === 'moderate' ? 'butter' : 'paper'}>
                        {s.llm_verdict}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > PAGE ? (
        <div className="flex items-center justify-between">
          <button className="brutal-btn-ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← prev
          </button>
          <span className="font-mono text-xs">
            page {page + 1} / {maxPage + 1} · {filtered.length} rows
          </span>
          <button
            className="brutal-btn-ghost"
            disabled={page >= maxPage}
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          >
            next →
          </button>
        </div>
      ) : null}

      <SectionTitle hint="how scoring works">Rule score</SectionTitle>
      <div className="brutal-card bg-butterSoft/50 p-4 font-mono text-xs leading-relaxed">
        volume/liquidity &gt; 3x → +0.25 · liquidity &gt; $100k → +0.20 · txns &gt; 1000 → +0.15 · mcap &lt;
        $10M → +0.10 · momentum+ → +0.10 · liquidity &lt; $20k → −0.30 · volume &lt; $5k → −0.20 (clamped 0–1,
        threshold 0.45)
      </div>
    </div>
  );
}
