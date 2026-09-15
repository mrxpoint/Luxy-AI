'use client';

import { useEffect, useState } from 'react';
import { Badge, EmptyState, OfflineBanner } from '@/components/ui';

interface PositionRow {
  id: number;
  agent: string;
  chain: string;
  token: string | null;
  side: string | null;
  status: string;
  size_usd: number;
  entry_price: number | null;
  exit_price: number | null;
  pnl_usd: number | null;
  pnl_pct: number | null;
  dry_run: boolean;
  opened_at: string;
  closed_at: string | null;
}

export default function PositionsPage() {
  const [rows, setRows] = useState<PositionRow[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/positions?limit=100', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { offline: boolean; rows: PositionRow[] }) => {
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
    return <div className="brutal-card h-64 animate-pulse bg-mintSoft/40" aria-busy="true" aria-label="Loading positions" />;
  }

  const open = rows.filter((r) => r.status === 'open');
  const closed = rows.filter((r) => r.status === 'closed');
  const totalPnl = closed.reduce((acc, r) => acc + Number(r.pnl_usd ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Positions</h1>
        <p className="mt-1 font-mono text-xs text-ink/60">
          every entry/exit passes the hardcoded risk guard before it reaches this table.
        </p>
      </div>

      {offline ? <OfflineBanner note="database unreachable — showing demo positions." /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="brutal-card bg-skySoft p-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink/60">Open</p>
          <p className="mt-1 text-2xl font-bold">{open.length}</p>
        </div>
        <div className="brutal-card bg-mintSoft p-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink/60">Closed</p>
          <p className="mt-1 text-2xl font-bold">{closed.length}</p>
        </div>
        <div className="brutal-card bg-butterSoft p-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink/60">Realized PnL</p>
          <p className={`mt-1 text-2xl font-bold ${totalPnl >= 0 ? '' : 'text-red-600'}`}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No positions yet"
          body="Start the executor (pnpm dev:executor) plus any agent. Dry-run fills are recorded exactly like live ones, marked dry_run=true."
        />
      ) : (
        <div className="brutal-card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>agent</th>
                <th>chain</th>
                <th>market</th>
                <th>side</th>
                <th>size</th>
                <th>entry</th>
                <th>exit</th>
                <th>pnl</th>
                <th>mode</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.agent}</td>
                  <td>{p.chain}</td>
                  <td className="max-w-[200px] truncate font-bold">{p.token ?? '—'}</td>
                  <td>{p.side ?? '—'}</td>
                  <td>${Number(p.size_usd).toFixed(2)}</td>
                  <td>{p.entry_price === null ? '—' : Number(p.entry_price).toPrecision(6)}</td>
                  <td>{p.exit_price === null ? '—' : Number(p.exit_price).toPrecision(6)}</td>
                  <td className={p.pnl_usd === null ? '' : Number(p.pnl_usd) >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                    {p.pnl_usd === null
                      ? '—'
                      : `${Number(p.pnl_usd) >= 0 ? '+' : ''}$${Number(p.pnl_usd).toFixed(2)} (${
                          p.pnl_pct === null ? '—' : `${(Number(p.pnl_pct) * 100).toFixed(1)}%`
                        })`}
                  </td>
                  <td>{p.dry_run ? <Badge tone="lilac">dry</Badge> : <Badge tone="coral">live</Badge>}</td>
                  <td>
                    <Badge tone={p.status === 'open' ? 'sky' : 'paper'}>{p.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
