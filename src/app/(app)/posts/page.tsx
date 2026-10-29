import Link from 'next/link';
import type { PostStatus } from '@prisma/client';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { LocalTime } from '@/components/local-time';
import { ProviderIcon } from '@/components/provider-icon';
import { StatusBadge } from '@/components/status-badge';

const FILTERS: { label: string; value?: PostStatus }[] = [
  { label: 'All' },
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'Drafts', value: 'DRAFT' },
  { label: 'Published', value: 'PUBLISHED' },
  { label: 'Failed', value: 'FAILED' },
];

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { org } = await requireOrg();
  const { status } = await searchParams;
  const filter = FILTERS.find((f) => f.value === status)?.value;

  const posts = await db.post.findMany({
    where: {
      orgId: org.id,
      ...(filter === 'FAILED' ? { status: { in: ['FAILED', 'PARTIAL'] } } : filter ? { status: filter } : {}),
    },
    select: {
      id: true,
      content: true,
      status: true,
      scheduledAt: true,
      updatedAt: true,
      author: { select: { name: true } },
      targets: { select: { status: true, externalUrl: true, error: true, channel: { select: { provider: true, name: true } } } },
    },
    orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'first' } }, { updatedAt: 'desc' }],
    take: 100,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="page-title mr-auto">Posts</h1>
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.value ? `/posts?status=${f.value}` : '/posts'}
            className={`rounded-lg px-3 py-1.5 text-sm ${filter === f.value ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="card divide-y divide-slate-100">
        {posts.length === 0 && <p className="p-6 text-sm text-slate-500">No posts here yet.</p>}
        {posts.map((post) => (
          <Link key={post.id} href={`/compose?id=${post.id}`} className="flex gap-4 p-4 hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 whitespace-pre-wrap text-sm">{post.content}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <StatusBadge status={post.status} />
                {post.scheduledAt ? <LocalTime iso={post.scheduledAt.toISOString()} /> : <span>Not scheduled</span>}
                <span>by {post.author.name}</span>
              </div>
              {post.targets
                .filter((t) => t.error)
                .map((t, i) => (
                  <p key={i} className="mt-1 text-xs text-red-600">
                    {t.channel.name}: {t.error}
                  </p>
                ))}
            </div>
            <div className="flex shrink-0 items-start gap-1">
              {post.targets.map((t, i) => (
                <span key={i} title={`${t.channel.name}: ${t.status.toLowerCase()}`} className={t.status === 'FAILED' ? 'opacity-40' : ''}>
                  <ProviderIcon provider={t.channel.provider} size={18} />
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
