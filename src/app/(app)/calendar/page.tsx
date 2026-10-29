import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { Calendar, type CalendarPost } from './calendar';

function parseMonth(value?: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  const now = new Date();
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : { year: now.getFullYear(), month: now.getMonth() };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { org } = await requireOrg();
  const { year, month } = parseMonth((await searchParams).month);

  // Generous window so the visible grid is covered in any time zone
  const from = new Date(Date.UTC(year, month, 1) - 8 * 24 * 60 * 60 * 1000);
  const to = new Date(Date.UTC(year, month + 1, 1) + 15 * 24 * 60 * 60 * 1000);

  const posts = await db.post.findMany({
    where: { orgId: org.id, scheduledAt: { gte: from, lt: to } },
    select: {
      id: true,
      content: true,
      status: true,
      scheduledAt: true,
      targets: { select: { channel: { select: { provider: true } } } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  const items: CalendarPost[] = posts.map((p) => ({
    id: p.id,
    content: p.content,
    status: p.status,
    scheduledAt: p.scheduledAt!.toISOString(),
    providers: [...new Set(p.targets.map((t) => t.channel.provider))],
  }));

  const unscheduled = await db.post.count({ where: { orgId: org.id, status: 'DRAFT', scheduledAt: null } });

  return <Calendar year={year} month={month} posts={items} unscheduledDrafts={unscheduled} />;
}
