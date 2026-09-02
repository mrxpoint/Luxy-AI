import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Luxy AI — Autonomous Trading Agent',
  description:
    'Open-source autonomous AI trading agent: screener, executor with hardcoded risk guard, HiveMind learning, and an in-session code terminal.',
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/signals', label: 'Signals' },
  { href: '/positions', label: 'Positions' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/chat', label: 'Chat' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-50 border-b-2 border-ink bg-canvas/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 group" aria-label="Luxy AI home">
              <span
                aria-hidden
                className="inline-block h-6 w-6 border-2 border-ink bg-coral shadow-brutal-sm group-hover:bg-butter transition-colors"
              />
              <span className="text-lg font-bold tracking-tight">
                LUXY<span className="text-coral">·</span>AI
              </span>
            </Link>
            <nav aria-label="Main navigation" className="flex flex-wrap gap-1 md:gap-2">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="border-2 border-transparent px-2 py-1 font-mono text-xs font-bold uppercase tracking-wide hover:border-ink hover:bg-butter hover:shadow-brutal-sm transition-all"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <span className="ml-auto brutal-badge bg-mintSoft">dry-run default</span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

        <footer className="mt-auto border-t-2 border-ink bg-paper">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-center md:flex-row md:text-left">
            <p className="font-mono text-xs text-ink/70">
              Luxy AI · Apache-2.0 · dry-run by default — never trade funds you cannot afford to lose.
            </p>
            <p className="font-mono text-xs text-ink/70">
              built by <span className="font-bold">mrxpoint</span> · inspired by Senpi.ai · E2B · Hyperliquid · Solana
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
