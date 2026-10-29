import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { canSchedule, providers } from '@/lib/providers';
import { Composer, type ComposerChannel, type ComposerPost } from './composer';

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ id?: string; date?: string }> }) {
  const { org } = await requireOrg();
  const { id, date } = await searchParams;

  const channels = await db.channel.findMany({
    where: { orgId: org.id },
    select: { id: true, provider: true, name: true, handle: true, needsReconnect: true },
    orderBy: { createdAt: 'asc' },
  });
  // Inbox-only channels (YouTube for now) can't be posted to; manual ones are posted by hand
  const composerChannels: ComposerChannel[] = channels.filter((c) => {
    const p = providers[c.provider as keyof typeof providers];
    return p && canSchedule(p);
  }).map((c) => {
    const p = providers[c.provider as keyof typeof providers];
    return { ...c, maxLength: p.maxLength, maxImages: p.maxImages, minImages: p.minImages ?? 0, manual: p.connectType === 'manual', providerName: p.name, postFields: p.postFields ?? [] };
  });

  let post: ComposerPost | null = null;
  if (id) {
    const found = await db.post.findFirst({
      where: { id, orgId: org.id },
      select: {
        id: true,
        content: true,
        status: true,
        scheduledAt: true,
        targets: { select: { channelId: true, status: true, externalUrl: true, error: true, options: true, publishAfter: true } },
        media: { select: { media: { select: { id: true, fileName: true } } }, orderBy: { position: 'asc' } },
      },
    });
    if (!found) notFound();
    post = {
      id: found.id,
      content: found.content,
      status: found.status,
      scheduledAt: found.scheduledAt?.toISOString() ?? null,
      targets: found.targets.map((t) => ({
        ...t,
        options: (t.options ?? {}) as Record<string, string>,
        publishAfter: t.publishAfter?.toISOString() ?? null,
      })),
      media: found.media.map(({ media }) => ({ id: media.id, url: `/media/${org.id}/${media.fileName}` })),
    };
  }

  return (
    <Composer
      key={post?.id ?? 'new'}
      channels={composerChannels}
      post={post}
      initialDate={/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : null}
    />
  );
}
