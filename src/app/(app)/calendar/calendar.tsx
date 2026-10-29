'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { STATUS_DOT } from '@/components/status-badge';
import { ProviderIcon } from '@/components/provider-icon';

export interface CalendarPost {
  id: string;
  content: string;
  status: string;
  scheduledAt: string;
  providers: string[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthParam(year: number, month: number) {
  const d = new Date(year, month, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function Calendar({
  year,
  month,
  posts,
  unscheduledDrafts,
}: {
  year: number;
  month: number;
  posts: CalendarPost[];
  unscheduledDrafts: number;
}) {
  // Dates depend on the viewer's time zone, so build the grid after mount
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(dayKey(new Date())), []);

  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7)); // back to Monday
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));

  const byDay = new Map<string, CalendarPost[]>();
  if (today) {
    for (const post of posts) {
      const key = dayKey(new Date(post.scheduledAt));
      byDay.set(key, [...(byDay.get(key) ?? []), post]);
    }
  }

  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-auto">{title}</h1>
        {unscheduledDrafts > 0 && (
          <Link href="/posts?status=DRAFT" className="text-sm text-slate-600 underline">
            {unscheduledDrafts} unscheduled draft{unscheduledDrafts === 1 ? '' : 's'}
          </Link>
        )}
        <Link className="btn-secondary" href={`/calendar?month=${monthParam(year, month - 1)}`}>‹ Prev</Link>
        <Link className="btn-secondary" href="/calendar">Today</Link>
        <Link className="btn-secondary" href={`/calendar?month=${monthParam(year, month + 1)}`}>Next ›</Link>
      </div>

      <div className="card grid grid-cols-7 overflow-hidden">
        {WEEKDAYS.map((d) => (
          <div key={d} className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-500">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === first.getMonth();
          const isPast = today !== null && key < today;
          return (
            <div
              key={key}
              className={`group relative min-h-28 border-b border-r border-slate-100 p-1.5 ${inMonth ? '' : 'bg-slate-50/60'}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    key === today ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-slate-700' : 'text-slate-400'
                  }`}
                >
                  {day.getDate()}
                </span>
                {!isPast && (
                  <Link
                    href={`/compose?date=${key}`}
                    className="hidden rounded px-1.5 text-xs text-brand-600 hover:bg-brand-50 group-hover:block"
                    aria-label={`New post on ${key}`}
                  >
                    + Post
                  </Link>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {(byDay.get(key) ?? []).map((post) => (
                  <Link
                    key={post.id}
                    href={`/compose?id=${post.id}`}
                    className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs hover:border-brand-500"
                    title={post.content}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[post.status]}`} />
                    <span className="shrink-0 text-slate-500">
                      {new Date(post.scheduledAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className="truncate">{post.content}</span>
                    <span className="ml-auto flex shrink-0 gap-0.5">
                      {post.providers.map((p) => (
                        <ProviderIcon key={p} provider={p} size={12} />
                      ))}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
