/** Shared brutalist UI primitives. */

export function Stat({
  label,
  value,
  sub,
  tone = 'paper',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'paper' | 'butter' | 'coral' | 'mint' | 'sky' | 'lilac';
}) {
  const bg: Record<string, string> = {
    paper: 'bg-paper',
    butter: 'bg-butterSoft',
    coral: 'bg-coralSoft',
    mint: 'bg-mintSoft',
    sky: 'bg-skySoft',
    lilac: 'bg-lilacSoft',
  };
  return (
    <div className={`brutal-card ${bg[tone]} p-4 md:p-6`}>
      <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink/60">{label}</p>
      <p className="mt-2 text-2xl font-bold md:text-3xl">{value}</p>
      {sub ? <p className="mt-1 font-mono text-xs text-ink/60">{sub}</p> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'butter',
}: {
  children: React.ReactNode;
  tone?: 'butter' | 'coral' | 'mint' | 'sky' | 'lilac' | 'paper';
}) {
  const bg: Record<string, string> = {
    butter: 'bg-butter',
    coral: 'bg-coral',
    mint: 'bg-mint',
    sky: 'bg-sky',
    lilac: 'bg-lilac',
    paper: 'bg-paper',
  };
  return <span className={`brutal-badge ${bg[tone]}`}>{children}</span>;
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-3">
      <h2 className="text-xl font-bold md:text-2xl">{children}</h2>
      {hint ? <p className="font-mono text-xs text-ink/60">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="brutal-card flex flex-col items-center gap-2 bg-butterSoft/60 p-8 text-center">
      <svg aria-hidden width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="18" fill="#FFD75E" stroke="#191714" strokeWidth="2" />
        <path d="M16 26 H32" stroke="#191714" strokeWidth="2" />
        <circle cx="18" cy="19" r="2" fill="#191714" />
        <circle cx="30" cy="19" r="2" fill="#191714" />
      </svg>
      <p className="font-bold">{title}</p>
      <p className="max-w-md font-mono text-xs text-ink/70">{body}</p>
    </div>
  );
}

export function OfflineBanner({ note }: { note: string }) {
  return (
    <div className="brutal-card bg-skySoft p-3">
      <p className="font-mono text-xs">
        <span className="font-bold">demo data</span> — {note}
      </p>
    </div>
  );
}
