'use client';

import { useEffect, useState } from 'react';
import { Badge, EmptyState, OfflineBanner } from '@/components/ui';

interface StrategyRow {
  id: number;
  agent: string;
  version: number;
  params: Record<string, unknown>;
  created_by: string;
  active: boolean;
  created_at: string;
}

export default function StrategyPage() {
  const [rows, setRows] = useState<StrategyRow[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/strategy', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { offline: boolean; rows: StrategyRow[] }) => {
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
    return <div className="brutal-card h-64 animate-pulse bg-lilacSoft/40" aria-busy="true" aria-label="Loading strategy" />;
  }

  const agents = [...new Set(rows.map((r) => r.agent))];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Strategy config</h1>
        <p className="mt-1 font-mono text-xs text-ink/60">
          versioned parameters per agent — Luxy proposes, you approve, versions are never overwritten.
        </p>
      </div>

      {offline ? <OfflineBanner note="database unreachable or empty — showing default v1 configs." /> : null}

      {agents.length === 0 ? (
        <EmptyState title="No strategy versions" body="Seed via the strategy_config table or let the Luxy agent propose its first version." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((agent) => (
            <section key={agent} className="brutal-card p-4 md:p-6" aria-label={`strategy for ${agent}`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold">{agent}</h2>
                <Badge tone="mint">v{rows.find((r) => r.agent === agent)?.version ?? 1}</Badge>
              </div>
              <ul className="flex flex-col gap-2">
                {rows
                  .filter((r) => r.agent === agent)
                  .map((r) => (
                    <li key={r.id} className="border-2 border-ink/15 bg-canvas p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={r.active ? 'butter' : 'paper'}>{r.active ? 'active' : 'retired'}</Badge>
                        <span className="font-mono text-[11px] text-ink/60">
                          v{r.version} · by {r.created_by} · {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                      <pre className="overflow-x-auto font-mono text-xs leading-relaxed">
                        {JSON.stringify(r.params, null, 2)}
                      </pre>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="brutal-card bg-coralSoft p-4">
        <p className="font-mono text-xs leading-relaxed">
          <span className="font-bold">immutable guardrails (not strategy — not tunable by the LLM):</span> max
          position 3% · daily drawdown kill switch 8% · slippage cap 2% · max 5 concurrent positions · global
          pause flag via Telegram /pause.
        </p>
      </div>
    </div>
  );
}
