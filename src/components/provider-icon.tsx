// Simple letter marks so we don't ship third-party brand assets
const MARKS: Record<string, { label: string; className: string }> = {
  bluesky: { label: 'B', className: 'bg-sky-500' },
  x: { label: 'X', className: 'bg-slate-900' },
  linkedin: { label: 'in', className: 'bg-blue-700' },
};

export function ProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
  const mark = MARKS[provider] ?? { label: '?', className: 'bg-slate-400' };
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded font-bold text-white ${mark.className}`}
      style={{ width: size, height: size, fontSize: Math.max(7, size * 0.55) }}
      aria-label={provider}
    >
      {mark.label}
    </span>
  );
}
