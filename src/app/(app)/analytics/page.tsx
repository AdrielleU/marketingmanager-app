import Link from 'next/link';
import { refreshAnalytics } from '@/actions/posts';
import { SubmitButton } from '@/components/form';
import { LocalTime } from '@/components/local-time';
import { ProviderIcon } from '@/components/provider-icon';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { providers } from '@/lib/providers';
import { EngagementChart } from './chart';

const RANGES = [7, 30, 90];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { org } = await requireOrg();
  const days = RANGES.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const targets = await db.postTarget.findMany({
    where: { status: 'PUBLISHED', publishedAt: { gte: since }, post: { orgId: org.id } },
    select: {
      id: true,
      publishedAt: true,
      externalUrl: true,
      post: { select: { content: true } },
      channel: { select: { id: true, provider: true, name: true } },
      metrics: { orderBy: { capturedAt: 'desc' }, take: 1 },
    },
    orderBy: { publishedAt: 'asc' },
  });

  const rows = targets.map((t) => {
    const m = t.metrics[0];
    const engagement = m ? m.likes + m.reposts + m.replies : 0;
    return { ...t, m, engagement };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      posts: acc.posts + 1,
      likes: acc.likes + (r.m?.likes ?? 0),
      reposts: acc.reposts + (r.m?.reposts ?? 0),
      replies: acc.replies + (r.m?.replies ?? 0),
      impressions: acc.impressions + (r.m?.impressions ?? 0),
    }),
    { posts: 0, likes: 0, reposts: 0, replies: 0, impressions: 0 },
  );

  const byChannel = new Map<string, { name: string; provider: string; posts: number; engagement: number }>();
  for (const r of rows) {
    const c = byChannel.get(r.channel.id) ?? { name: r.channel.name, provider: r.channel.provider, posts: 0, engagement: 0 };
    c.posts += 1;
    c.engagement += r.engagement;
    byChannel.set(r.channel.id, c);
  }

  // Engagement grouped by publish day (UTC) for the chart
  const daily = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) daily.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0);
  for (const r of rows) {
    const key = r.publishedAt!.toISOString().slice(0, 10);
    if (daily.has(key)) daily.set(key, daily.get(key)! + r.engagement);
  }

  const top = [...rows].sort((a, b) => b.engagement - a.engagement).slice(0, 10);
  const lastUpdated = rows.flatMap((r) => (r.m ? [r.m.capturedAt] : [])).sort((a, b) => b.getTime() - a.getTime())[0];

  const stats = [
    { label: 'Posts published', value: totals.posts },
    { label: 'Likes', value: totals.likes },
    { label: 'Reposts', value: totals.reposts },
    { label: 'Replies', value: totals.replies },
    { label: 'Impressions (X)', value: totals.impressions },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="page-title mr-auto">Analytics</h1>
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/analytics?days=${r}`}
            className={`rounded-lg px-3 py-1.5 text-sm ${r === days ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {r} days
          </Link>
        ))}
        <form action={refreshAnalytics}>
          <SubmitButton className="btn-secondary">Refresh now</SubmitButton>
        </form>
      </div>
      <p className="-mt-4 text-xs text-slate-500">
        Stats update automatically every 30 minutes.{' '}
        {lastUpdated && (
          <>
            Last update: <LocalTime iso={lastUpdated.toISOString()} />
          </>
        )}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-medium">Engagement by publish day</h2>
        <EngagementChart data={[...daily].map(([date, value]) => ({ date, value }))} />
      </section>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-medium">By channel</h2>
          {byChannel.size === 0 && <p className="text-sm text-slate-500">Nothing published in this period.</p>}
          <ul className="space-y-3">
            {[...byChannel.values()].map((c) => (
              <li key={c.name + c.provider} className="flex items-center gap-2 text-sm">
                <ProviderIcon provider={c.provider} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="tabular-nums text-slate-500">
                  {providers[c.provider as keyof typeof providers]?.supportsMetrics
                    ? `${c.engagement.toLocaleString()} eng.`
                    : 'no stats'}{' '}
                  · {c.posts} posts
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card overflow-hidden">
          <h2 className="p-5 pb-3 text-sm font-medium">Top posts</h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Post</th>
                <th className="px-2 py-2 text-right font-medium">Likes</th>
                <th className="px-2 py-2 text-right font-medium">Reposts</th>
                <th className="px-5 py-2 text-right font-medium">Replies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {top.map((r) => (
                <tr key={r.id}>
                  <td className="max-w-0 px-5 py-2">
                    <a href={r.externalUrl ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
                      <ProviderIcon provider={r.channel.provider} size={14} />
                      <span className="truncate">{r.post.content}</span>
                    </a>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.m?.likes ?? '–'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.m?.reposts ?? '–'}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.m?.replies ?? '–'}</td>
                </tr>
              ))}
              {top.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-4 text-slate-500">No published posts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
