/**
 * Luxy TUI — Ink terminal dashboard (BLUEPRINT.md §10.3, Phase 4).
 *
 * Multi-panel monitor over SSH, no browser needed:
 *   ┌ PRICE FEED ┐ ┌ ACTIVE POSITIONS ┐
 *   └ RECENT ALERTS (static — not overwritten on re-render) ┘
 *
 * Written with React.createElement (no JSX) so the root TypeScript config
 * stays JS-only. Data sources: Hyperliquid allMids (free) + PostgreSQL
 * positions/audit_log; every source degrades gracefully when offline.
 *
 * Run: pnpm tui   (Ctrl+C to exit)
 */
import React, { createElement as h, useState, useEffect } from 'react';
import { render, Box, Text, Static } from 'ink';
import { fetchAllMids } from '../agents/perps/hyperliquid.js';
import { config } from '../config/index.js';
import { Pool } from 'pg';
import { logger } from '../utils/logger.js';

// TUI must not spam the terminal — silence the logger transport.
logger.level = 'silent';

interface AlertItem {
  key: string;
  time: string;
  line: string;
}

const globalStore = globalThis as unknown as { luxyTuiPool?: Pool };
function pool(): Pool {
  globalStore.luxyTuiPool ??= new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 2_500,
  });
  return globalStore.luxyTuiPool;
}

const PRICE_MARKETS = ['BTC', 'ETH', 'SOL', 'WIF', 'PEPE', 'ARB'];

function usePrices(): { prices: Array<{ market: string; price: string }>; online: boolean } {
  const [state, setState] = useState<{ prices: Array<{ market: string; price: string }>; online: boolean }>({
    prices: [],
    online: false,
  });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const mids = await fetchAllMids();
        const prices = PRICE_MARKETS.filter((m) => mids[m] !== undefined).map((m) => ({
          market: m,
          price: Number(mids[m]).toLocaleString(undefined, { maximumFractionDigits: mids[m].length > 8 ? 6 : 2 }),
        }));
        if (alive) setState({ prices, online: true });
      } catch {
        if (alive) setState({ prices: [], online: false });
      }
    };
    void tick;
    const t = setInterval(tick, 5_000);
    void tick();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return state;
}

interface PositionRowTui {
  agent: string;
  chain: string;
  token: string | null;
  side: string | null;
  size_usd: string;
  entry_price: string | null;
}

function usePositions(): { rows: PositionRowTui[]; online: boolean } {
  const [state, setState] = useState<{ rows: PositionRowTui[]; online: boolean }>({ rows: [], online: false });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await pool().query<PositionRowTui>(
          `SELECT agent, chain, token, side, size_usd, entry_price
           FROM positions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 8`,
        );
        if (alive) setState({ rows: res.rows, online: true });
      } catch {
        if (alive) setState({ rows: [], online: false });
      }
    };
    const t = setInterval(tick, 10_000);
    void tick();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return state;
}

function useAlerts(): AlertItem[] {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  useEffect(() => {
    let alive = true;
    let lastId = 0;
    const tick = async () => {
      try {
        const res = await pool().query<{ id: number; created_at: string; action: string; payload: unknown }>(
          `SELECT id, created_at, action, payload FROM audit_log
           WHERE id > $1 AND action NOT IN ('strategy_proposed')
           ORDER BY id ASC LIMIT 20`,
          [lastId],
        );
        if (!alive || res.rows.length === 0) return;
        lastId = res.rows[res.rows.length - 1].id;
        const items = res.rows.map((r) => ({
          key: String(r.id),
          time: new Date(r.created_at).toLocaleTimeString(),
          line: `[${r.action.toUpperCase()}] ${summarize(r.payload)}`,
        }));
        setAlerts((prev) => [...prev, ...items].slice(-30));
      } catch {
        // db offline — alerts stay empty
      }
    };
    const t = setInterval(tick, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return alerts;
}

function summarize(payload: unknown): string {
  try {
    const p = typeof payload === 'string' ? (JSON.parse(payload) as Record<string, unknown>) : (payload as Record<string, unknown>);
    if (p?.intent) {
      const i = p.intent as Record<string, unknown>;
      return `${i.action ?? ''} ${i.symbol ?? i.token ?? i.market ?? ''} $${i.sizeUsd ?? ''}`.trim();
    }
    if (p?.token && p?.symbol) return `${p.symbol} score=${p.score ?? ''}`.trim();
    if (p?.reason) return String(p.reason);
    return JSON.stringify(p ?? {}).slice(0, 90);
  } catch {
    return '';
  }
}

function Panel({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width="50%">
      <Text bold color={color}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function App(): React.ReactElement {
  const { prices, online: pricesOnline } = usePrices();
  const { rows, online: dbOnline } = usePositions();
  const alerts = useAlerts();

  return (
    <Box flexDirection="column" gap={1}>
      <Static items={alerts}>
        {(alert) => (
          <Text key={alert.key} dimColor>
            {alert.time} {alert.line}
          </Text>
        )}
      </Static>

      <Box gap={1}>
        <Panel title="PRICE FEED" color="yellow">
          {pricesOnline
            ? prices.map((p) => (
                <Text key={p.market}>
                  {p.market.padEnd(6)} ${p.price}
                </Text>
              ))
            : <Text dimColor>price feed offline (hyperliquid unreachable)</Text>}
        </Panel>
        <Panel title="ACTIVE POSITIONS" color="green">
          {dbOnline
            ? rows.length === 0
              ? <Text dimColor>no open positions</Text>
              : rows.map((r, i) => (
                  <Text key={i}>
                    {(r.token ?? r.chain).slice(0, 10).padEnd(11)} {r.agent.padEnd(5)} ${Number(r.size_usd).toFixed(0)}
                    {r.side ? ` ${r.side}` : ''}
                  </Text>
                ))
            : <Text dimColor>db offline (postgres unreachable)</Text>}
        </Panel>
      </Box>

      <Text dimColor>
        luxy tui · dry_run={String(config.DRY_RUN)} · ctrl+c to exit · full UI at :3000
      </Text>
    </Box>
  );
}

render(h(App));
