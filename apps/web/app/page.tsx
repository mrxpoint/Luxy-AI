'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Stat, Badge, SectionTitle, EmptyState, OfflineBanner } from '@/components/ui';
import { BauhausHero, BauhausBanner } from '@/components/bauhaus';
import type { DashboardData } from '@/lib/db';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/dashboard', { cache: 'no-store' });
        const json = (await res.json()) as DashboardData;
        if (alive) setData(json);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'failed to load');
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) {
    return <EmptyState title="Dashboard unavailable" body={error} />;
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading dashboard">
        {['open', 'pnl', 'signals', 'mode'].map((k) => (
          <div key={k} className="brutal-card h-28 animate-pulse bg-butterSoft/40 p-4" />
        ))}
      </div>
    );
  }

  const pnl = data.todayPnlUsd;

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <section className="brutal-card relative overflow-hidden bg-paper p-6 md:p-8">
        <BauhausBanner className="absolute right-4 top-4 hidden md:block" />
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h1 className="text-3xl font-bold md:text-4xl">Autonomous trading, validated in code.</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink/70">
              Screener feeds the Luxy agent, every decision is backtested before an intent is
              emitted, and a hardcoded risk guard has the final say. Dry-run by default — the LLM
              can never override position limits, drawdown kill switches, or slippage caps.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="butter">screener 5m</Badge>
              <Badge tone="sky">perps 15m</Badge>
              <Badge tone="mint">hunter 30m · healer 10m</Badge>
              <Badge tone="lilac">narrative 20m</Badge>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/chat" className="brutal-btn-primary">Talk to Luxy</Link>
              <Link href="/signals" className="brutal-btn-ghost">Browse signals</Link>
            </div>
          </div>
          <BauhausHero />
        </div>
      </section>

      {data.offline ? (
        <OfflineBanner note="database unreachable (is docker compose up?) — showing demo data so you can explore the UI." />
      ) : null}

      {/* Stats */}
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open positions" value={String(data.openPositions)} sub="max 5 concurrent" tone="sky" />
        <Stat
          label="Today PnL"
          value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
          sub="realized, all agents"
          tone={pnl >= 0 ? 'mint' : 'coral'}
        />
        <Stat label="Signals (24h)" value={String(data.signalCount24h)} sub="screener + narrative" tone="butter" />
        <Stat label="Runtime mode" value="DRY-RUN" sub="simulated fills only" tone="lilac" />
      </section>

      {/* Recent signals */}
      <section aria-label="Recent signals">
        <SectionTitle hint="latest 8 from the signals table">Recent signals</SectionTitle>
        {data.signals.length === 0 ? (
          <EmptyState
            title="No signals yet"
            body="Start the screener (pnpm dev:screener) — scored candidates above 0.45 that pass the LLM filter will appear here."
          />
        ) : (
          <div className="brutal-card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>time</th>
                  <th>source</th>
                  <th>symbol</th>
                  <th>chain</th>
                  <th>score</th>
                  <th>verdict</th>
                </tr>
              </thead>
              <tbody>
                {data.signals.map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.created_at).toLocaleTimeString()}</td>
                    <td>{s.source}</td>
                    <td className="font-bold">{s.symbol ?? '—'}</td>
                    <td>{s.chain}</td>
                    <td>{Number(s.score).toFixed(2)}</td>
                    <td>{s.llm_verdict ? <Badge tone={s.llm_verdict === 'strong' ? 'mint' : 'butter'}>{s.llm_verdict}</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent positions */}
      <section aria-label="Recent positions">
        <SectionTitle hint="open + closed, newest first">Recent positions</SectionTitle>
        {data.recentPositions.length === 0 ? (
          <EmptyState
            title="No positions yet"
            body="Positions appear once the executor processes an intent. In dry-run everything is simulated end-to-end."
          />
        ) : (
          <div className="brutal-card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>agent</th>
                  <th>market</th>
                  <th>side</th>
                  <th>size</th>
                  <th>pnl</th>
                  <th>status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPositions.map((p) => (
                  <tr key={p.id}>
                    <td>{p.agent}</td>
                    <td className="max-w-[220px] truncate font-bold">{p.token ?? '—'}</td>
                    <td>{p.side ?? '—'}</td>
                    <td>${Number(p.size_usd).toFixed(2)}</td>
                    <td className={p.pnl_usd === null ? '' : Number(p.pnl_usd) >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                      {p.pnl_usd === null ? '—' : `${Number(p.pnl_usd) >= 0 ? '+' : ''}$${Number(p.pnl_usd).toFixed(2)}`}
                    </td>
                    <td>
                      <Badge tone={p.status === 'open' ? 'sky' : 'paper'}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
