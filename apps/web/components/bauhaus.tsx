/**
 * Bauhaus geometric primitives — decorative shapes used across the UI.
 * Pure presentational, aria-hidden (they carry no information).
 */
export function BauhausCorner({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none select-none ${className}`}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <path d="M0 0 H36 A36 36 0 0 1 0 36 Z" fill="#FFD75E" stroke="#191714" strokeWidth="2" />
        <circle cx="54" cy="54" r="14" fill="#FF9B85" stroke="#191714" strokeWidth="2" />
        <rect x="8" y="44" width="20" height="20" fill="#9FE0C0" stroke="#191714" strokeWidth="2" />
      </svg>
    </div>
  );
}

export function BauhausBanner({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none select-none ${className}`}>
      <svg width="160" height="28" viewBox="0 0 160 28">
        <circle cx="14" cy="14" r="12" fill="#9CCFEF" stroke="#191714" strokeWidth="2" />
        <rect x="34" y="4" width="20" height="20" fill="#FFD75E" stroke="#191714" strokeWidth="2" />
        <path d="M64 24 L78 4 L92 24 Z" fill="#FF9B85" stroke="#191714" strokeWidth="2" />
        <path d="M102 24 A12 12 0 0 1 126 24 Z" fill="#C9B8F5" stroke="#191714" strokeWidth="2" />
        <rect x="136" y="6" width="16" height="16" fill="#9FE0C0" stroke="#191714" strokeWidth="2" />
      </svg>
    </div>
  );
}

export function BauhausHero() {
  return (
    <div aria-hidden className="flex flex-wrap items-end gap-3">
      <svg width="88" height="88" viewBox="0 0 88 88" className="border-2 border-ink bg-butter shadow-brutal">
        <circle cx="30" cy="30" r="22" fill="#FF9B85" stroke="#191714" strokeWidth="2" />
        <path d="M0 88 A88 88 0 0 1 88 0 L88 88 Z" fill="#9CCFEF" stroke="#191714" strokeWidth="2" />
      </svg>
      <svg width="88" height="88" viewBox="0 0 88 88" className="border-2 border-ink bg-paper shadow-brutal">
        <rect x="10" y="10" width="30" height="68" fill="#C9B8F5" stroke="#191714" strokeWidth="2" />
        <path d="M50 78 L50 30 L82 78 Z" fill="#9FE0C0" stroke="#191714" strokeWidth="2" />
      </svg>
      <svg width="88" height="88" viewBox="0 0 88 88" className="border-2 border-ink bg-mintSoft shadow-brutal">
        <circle cx="44" cy="44" r="30" fill="#FFD75E" stroke="#191714" strokeWidth="2" />
        <path d="M44 14 L44 74 M14 44 L74 44" stroke="#191714" strokeWidth="2" />
      </svg>
    </div>
  );
}
