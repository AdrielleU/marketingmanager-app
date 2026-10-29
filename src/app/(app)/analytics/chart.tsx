'use client';

import { useState } from 'react';

/** Minimal responsive SVG bar chart with a hover readout. */
export function EngagementChart({ data }: { data: { date: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 100;
  const height = 40;
  const gap = data.length > 40 ? 0.15 : 0.4;
  const barWidth = width / data.length;

  const shown = hover !== null ? data[hover] : null;
  const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return (
    <div>
      <p className="mb-2 h-5 text-xs text-slate-600">
        {shown ? `${label(shown.date)}: ${shown.value.toLocaleString()} engagements` : 'Hover a bar for details'}
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-40 w-full" onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 1);
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={i * barWidth} y={0} width={barWidth} height={height} fill="transparent" />
              <rect
                x={i * barWidth + gap / 2}
                y={height - Math.max(h, d.value ? 0.6 : 0.2)}
                width={Math.max(barWidth - gap, 0.2)}
                height={Math.max(h, d.value ? 0.6 : 0.2)}
                className={hover === i ? 'fill-brand-700' : 'fill-brand-500'}
                rx={0.3}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{data[0] && label(data[0].date)}</span>
        <span>{data.at(-1) && label(data.at(-1)!.date)}</span>
      </div>
    </div>
  );
}
