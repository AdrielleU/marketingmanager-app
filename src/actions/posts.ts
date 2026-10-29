'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireOrg } from '@/lib/auth';
import { getProvider } from '@/lib/providers';
import { refreshMetrics } from '@/lib/publishing';

const EDITABLE = ['DRAFT', 'SCHEDULED', 'FAILED'] as const;

const savePostSchema = z.object({
  id: z.string().optional(),
  content: z.string().trim().min(1, 'Write something first').max(10_000),
  channelIds: z.array(z.string()).max(20),
  mediaIds: z.array(z.string()).max(9),
  intent: z.enum(['draft', 'schedule', 'now']),
  scheduledAt: z.string().datetime().nullable(),
});

export type SavePostInput = z.infer<typeof savePostSchema>;
export type SavePostResult = { ok: true; id: string } | { ok: false; error: string };

export async function savePost(input: SavePostInput): Promise<SavePostResult> {
  const { org, user } = await requireOrg();
  const parsed = savePostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const data = parsed.data;

  const channels = await db.channel.findMany({
    where: { id: { in: data.channelIds }, orgId: org.id },
    select: { id: true, provider: true, name: true, needsReconnect: true },
  });
  const media = await db.media.findMany({
    where: { id: { in: data.mediaIds }, orgId: org.id },
    select: { id: true },
  });

  let scheduledAt: Date | null = null;
  if (data.intent !== 'draft') {
    if (channels.length === 0) return { ok: false, error: 'Pick at least one channel' };
    const broken = channels.find((c) => c.needsReconnect);
    if (broken) return { ok: false, error: `${broken.name} needs to be reconnected first` };

    for (const channel of channels) {
      const provider = getProvider(channel.provider);
      if (data.content.length > provider.maxLength) {
        return { ok: false, error: `${provider.name} allows ${provider.maxLength} characters` };
      }
      if (media.length > provider.maxImages) {
        return { ok: false, error: `${provider.name} allows ${provider.maxImages} images` };
      }
    }

    if (data.intent === 'now') scheduledAt = new Date();
    else {
      if (!data.scheduledAt) return { ok: false, error: 'Pick a date and time' };
      scheduledAt = new Date(data.scheduledAt);
      if (scheduledAt.getTime() < Date.now() - 60_000) return { ok: false, error: 'That time is in the past' };
    }
  } else if (data.scheduledAt) {
    scheduledAt = new Date(data.scheduledAt); // drafts keep their planned slot on the calendar
  }

  const fields = {
    content: data.content,
    status: data.intent === 'draft' ? ('DRAFT' as const) : ('SCHEDULED' as const),
    scheduledAt,
  };
  const relations = {
    targets: { create: channels.map((c) => ({ channelId: c.id })) },
    media: { create: media.map((m, position) => ({ mediaId: m.id, position })) },
  };

  let id = data.id;
  if (id) {
    // Only rewrite posts nothing has been published from yet; updateMany guards against the worker racing us
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.post.updateMany({
        where: { id, orgId: org.id, status: { in: [...EDITABLE] } },
        data: fields,
      });
      if (updated.count === 0) return false;
      await tx.postTarget.deleteMany({ where: { postId: id } });
      await tx.postMedia.deleteMany({ where: { postId: id } });
      await tx.post.update({ where: { id }, data: relations });
      return true;
    });
    if (!result) return { ok: false, error: 'This post is publishing or already published and can no longer be edited' };
  } else {
    const post = await db.post.create({
      data: { orgId: org.id, authorId: user.id, ...fields, ...relations },
      select: { id: true },
    });
    id = post.id;
  }

  revalidatePath('/calendar');
  revalidatePath('/posts');
  return { ok: true, id: id! };
}

export async function deletePost(form: FormData) {
  const { org } = await requireOrg();
  await db.post.deleteMany({
    where: { id: String(form.get('postId')), orgId: org.id, status: { not: 'PUBLISHING' } },
  });
  revalidatePath('/calendar');
  redirect('/posts');
}

/** Re-queue only the channels that failed; ones that already published are left alone. */
export async function retryFailed(form: FormData) {
  const { org } = await requireOrg();
  const postId = String(form.get('postId'));
  await db.$transaction(async (tx) => {
    const post = await tx.post.updateMany({
      where: { id: postId, orgId: org.id, status: { in: ['FAILED', 'PARTIAL'] } },
      data: { status: 'SCHEDULED', scheduledAt: new Date() },
    });
    if (post.count === 0) return;
    await tx.postTarget.updateMany({ where: { postId, status: 'FAILED' }, data: { status: 'PENDING', error: null } });
  });
  revalidatePath('/posts');
  revalidatePath('/calendar');
}

export async function refreshAnalytics() {
  const { org } = await requireOrg();
  await refreshMetrics(org.id);
  revalidatePath('/analytics');
}
