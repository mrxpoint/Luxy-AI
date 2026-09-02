'use client';

import { useEffect, useState } from 'react';
import { EmptyState, OfflineBanner, SectionTitle } from '@/components/ui';

interface EvaluationRow {
  agent: string;
  version: number;
  runs: number;
  avg_win_rate: number;
  avg_sharpe: number;
  avg_max_drawdown: number;
  total_trades: number;
  last_run: string;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Bar-meter with brutalist styling (0..1 scale input). */
function Meter({ value, tone }: { value: number; tone: 'mint' | 'butter' | 'coral' }) {
  const bg = tone === 'mint' ? 'bg-mint' : tone === 'butter' ? 'bg-butter' : 'bg-coral';
  const width = Math.max(0, Math.min(1, Math.abs(value))) * 100;
  return (
    <div className="h-3 w-full border-2 border-ink bg-paper" role="presentation">
      <div className={`h-full ${bg}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export default function EvaluationPage() {
  const [rows, setRows] = useState<EvaluationRow[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    fetch('/api/evaluation', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { offline: boolean; rows: EvaluationRow[] }) => {
        setRows(d.rows);
        setOffline(d.offline);
      })
      .catch(() => setRows([]));
  }, []);

  if (!rows) {
    return (
      <div className="brutal-card h-64 animate-pulse bg-skySoft/40" aria-busy="true" aria-label="Loading evaluation" />
    );
  }

  const best = rows.reduce<EvaluationRow | null>(
    (acc, r) => (acc === null || r.avg_sharpe > acc.avg_sharpe ? r : acc),
    null,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Strategy evaluation</h1>
        <p className="mt-1 font-mono text-xs text-ink/60">
          backtest comparison across strategy versions — feeds the Phase 4 fine-tuning dataset.
        </p>
      </div>

      {offline ? <OfflineBanner note="database unreachable or empty — showing sample aggregates." /> : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No backtest runs yet"
          body="Runs appear here after the Luxy agent evaluates signals (backtest_runs table) or the replay engine is executed (pnpm replay)."
        />
      ) : (
        <>
          {best ? (
            <div className="brutal-card bg-mintSoft p-4">
              <p className="font-mono text-xs">
                <span className="font-bold">best version so far:</span> {best.agent} v{best.version} — sharpe{' '}
                {best.avg_sharpe.toFixed(2)}, win rate {pct(best.avg_win_rate)} over {best.total_trades} simulated
                trades.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            {rows.map((r) => (
              <section
                key={`${r.agent}-${r.version}`}
                className="brutal-card p-4 md:p-6"
                aria-label={`evaluation ${r.agent} v${r.version}`}
              >
                <SectionTitle hint={`${r.runs} runs · last ${new Date(r.last_run).toLocaleString()}`}>
                  {r.agent} v{r.version}
                </SectionTitle>
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <p className="mb-1 font-mono text-[11px] font-bold uppercase tracking-widest text-ink/60">
                      win rate
                    </p>
                    <p className="mb-1 text-xl font-bold">{pct(r.avg_win_rate)}</p>
                    <Meter value={r.avg_win_rate} tone={r.avg_win_rate >= 0.55 ? 'mint' : 'coral'} />
                  </div>
                  <div>
                    <p className="mb-1 font-mono text-[11px] font-bold uppercase tracking-widest text-ink/60">
                      sharpe
                    </p>
                    <p className="mb-1 text-xl font-bold">{r.avg_sharpe.toFixed(2)}</p>
                    <Meter value={Math.min(r.avg_sharpe / 2, 1)} tone="butter" />
                  </div>
                  <div>
                    <p className="mb-1 font-mono text-[11px] font-bold uppercase tracking-widest text-ink/60">
                      avg max drawdown
                    </p>
                    <p className="mb-1 text-xl font-bold">{pct(r.avg_max_drawdown)}</p>
                    <Meter value={r.avg_max_drawdown / 0.2} tone="coral" />
                  </div>
                  <div>
                    <p className="mb-1 font-mono text-[11px] font-bold uppercase tracking-widest text-ink/60">
                      simulated trades
                    </p>
                    <p className="text-xl font-bold">{r.total_trades}</p>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      <div className="brutal-card bg-skySoft p-4">
        <p className="font-mono text-xs leading-relaxed">
          <span className="font-bold">how to read this:</span> every backtest run is tagged with the active strategy
          version at decision time. Versions with a win rate ≥ 55% and ≥ 10 trades pass the Luxy preflight gate
          (BLUEPRINT §4.6). Export the labeled dataset with <span className="font-bold">pnpm ft:export</span>.
        </p>
      </div>
    </div>
  );
}
