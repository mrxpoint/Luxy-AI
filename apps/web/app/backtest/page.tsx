'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState, OfflineBanner, SectionTitle } from '@/components/ui';

interface Metrics {
  win_rate: number;
  avg_return: number;
  sharpe: number;
  max_drawdown: number;
  n_trades: number;
}

interface RunRow {
  id: number;
  engine: string;
  params: Record<string, unknown>;
  result: Metrics;
  created_at: string;
}

export default function BacktestPage() {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [symbol, setSymbol] = useState('BTC');
  const [interval, setInterval] = useState('1h');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastMetrics, setLastMetrics] = useState<Metrics | null>(null);

  const load = useCallback(() => {
    fetch('/api/backtest', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { offline: boolean; rows: RunRow[] }) => {
        setRows(d.rows);
        setOffline(d.offline);
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runJob() {
    setBusy(true);
    setMessage(null);
    setLastMetrics(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue: 'hyperliquid', symbol, interval, days }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMessage(data.message ?? 'failed');
      } else {
        setLastMetrics(data.metrics);
        setMessage(`ok — ${data.chartPoints ?? 0} candles`);
        load();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!rows) {
    return (
      <div
        className="brutal-card h-64 animate-pulse bg-skySoft/40"
        aria-busy="true"
        aria-label="Loading backtest"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Interactive backtest</h1>
        <p className="mt-1 font-mono text-xs text-ink/60">
          research only — never places live orders. Needs candles in Timescale (ingest or /candles).
        </p>
      </div>

      {offline ? <OfflineBanner note="database unreachable" /> : null}

      <section className="brutal-card flex flex-col gap-4 p-4 md:p-6">
        <SectionTitle>Run</SectionTitle>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 font-mono text-xs">
            symbol
            <input
              className="border-2 border-ink bg-paper px-2 py-2 text-sm"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-xs">
            interval
            <select
              className="border-2 border-ink bg-paper px-2 py-2 text-sm"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            >
              {['15m', '1h', '4h', '1d'].map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-mono text-xs">
            days
            <input
              type="number"
              min={1}
              max={365}
              className="border-2 border-ink bg-paper px-2 py-2 text-sm"
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 30)}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={busy}
              onClick={runJob}
              className="w-full border-2 border-ink bg-ink px-4 py-2 font-bold text-paper disabled:opacity-50"
            >
              {busy ? 'running…' : 'run momentum'}
            </button>
          </div>
        </div>
        {message ? <p className="font-mono text-xs text-ink/70">{message}</p> : null}
        {lastMetrics ? (
          <div className="grid grid-cols-2 gap-2 font-mono text-sm md:grid-cols-5">
            <Metric label="win_rate" value={`${(lastMetrics.win_rate * 100).toFixed(1)}%`} />
            <Metric label="sharpe" value={lastMetrics.sharpe.toFixed(2)} />
            <Metric label="max_dd" value={`${(lastMetrics.max_drawdown * 100).toFixed(1)}%`} />
            <Metric label="avg_ret" value={lastMetrics.avg_return.toFixed(4)} />
            <Metric label="n_trades" value={String(lastMetrics.n_trades)} />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Recent runs</SectionTitle>
        {rows.length === 0 ? (
          <EmptyState
            title="No backtest runs yet"
            body="Run a job above, use Telegram /backtest, or wait for agent in-session backtests."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const m = r.result;
              const p = r.params ?? {};
              return (
                <li key={r.id} className="brutal-card flex flex-col gap-1 p-3 font-mono text-xs md:flex-row md:items-center md:justify-between">
                  <span>
                    #{r.id} {String(p.symbol ?? p.venue ?? '—')} · {r.engine} ·{' '}
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  <span>
                    wr {((m?.win_rate ?? 0) * 100).toFixed(0)}% · sharpe {(m?.sharpe ?? 0).toFixed(2)} · n=
                    {m?.n_trades ?? 0}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-ink p-2">
      <div className="text-[10px] uppercase text-ink/50">{label}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}
