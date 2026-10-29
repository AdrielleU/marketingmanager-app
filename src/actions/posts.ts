'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireOrg } from '@/lib/auth';
import type { FormState } from './auth';
import { duplicateWarnings } from '@/lib/duplicates';
import { canSchedule, getProvider } from '@/lib/providers';
import { finalizePost, refreshMetrics } from '@/lib/publishing';

const EDITABLE = ['DRAFT', 'SCHEDULED', 'FAILED'] as const;

const savePostSchema = z.object({
  id: z.string().optional(),
  content: z.string().trim().min(1, 'Write something first').max(10_000),
  channelIds: z.array(z.string()).max(20),
  mediaIds: z.array(z.string()).max(9),
  // Per-channel values for the provider's postFields, keyed by channel id
  options: z.record(z.string(), z.record(z.string(), z.string().trim().max(1000))).default({}),
  intent: z.enum(['draft', 'schedule', 'now']),
  // Set after the user has seen and accepted the duplicate warnings
  ignoreWarnings: z.boolean().default(false),
  scheduledAt: z.string().datetime().nullable(),
});

export type SavePostInput = z.infer<typeof savePostSchema>;
// `confirm`: the error is a warning the user may accept by resubmitting with ignoreWarnings
export type SavePostResult = { ok: true; id: string } | { ok: false; error: string; confirm?: boolean };

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
      if (!canSchedule(provider)) return { ok: false, error: `${provider.name} channels can't be posted to from the app` };
      if (data.content.length > provider.maxLength) {
        return { ok: false, error: `${provider.name} allows ${provider.maxLength} characters` };
      }
      if (provider.minImages && media.length < provider.minImages) {
        return { ok: false, error: `${provider.name} posts need at least ${provider.minImages} image${provider.minImages > 1 ? 's' : ''}` };
      }
      if (media.length > provider.maxImages) {
        const limit = provider.maxImages === 0 ? "doesn't support images" : `allows ${provider.maxImages} images`;
        return { ok: false, error: `${provider.name} ${limit}` };
      }
      for (const field of provider.postFields ?? []) {
        const value = data.options[channel.id]?.[field.name] ?? '';
        if (field.required && !value) return { ok: false, error: `${channel.name}: ${field.label} is required` };
        if (value.length > field.maxLength) {
          return { ok: false, error: `${channel.name}: ${field.label} allows ${field.maxLength} characters` };
        }
      }
    }

    if (!data.ignoreWarnings) {
      const warnings = await duplicateWarnings(org.id, data.id, data.content, channels);
      if (warnings.length) return { ok: false, error: warnings.join(' '), confirm: true };
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
    targets: { create: channels.map((c) => ({ channelId: c.id, options: pickOptions(c.provider, data.options[c.id]) })) },
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

/** Keeps only the fields the provider declares, so the client can't stash arbitrary data on a target. */
function pickOptions(providerId: string, values: Record<string, string> = {}) {
  const fields = getProvider(providerId).postFields ?? [];
  if (fields.length === 0) return undefined;
  return Object.fromEntries(fields.map((f) => [f.name, values[f.name] ?? '']));
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

const postedSchema = z.object({
  targetId: z.string(),
  // Optional link to the live post, so the post page and inbox can point at it
  url: z.union([z.literal(''), z.string().trim().url('Paste the full link to the post').max(1000)]),
});

/** A person posted a manual channel's copy by hand. */
export async function markPosted(_: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrg();
  const parsed = postedSchema.safeParse({ targetId: form.get('targetId'), url: form.get('url') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.url && !/^https?:\/\//i.test(parsed.data.url)) return { error: 'Paste the full link to the post' };

  const target = await db.postTarget.findFirst({
    where: { id: parsed.data.targetId, status: 'READY', post: { orgId: org.id } },
    select: { id: true, postId: true },
  });
  if (!target) return { error: 'This was already handled' };
  await db.postTarget.update({
    where: { id: target.id },
    data: { status: 'PUBLISHED', publishedAt: new Date(), externalUrl: parsed.data.url || null, error: null },
  });
  await finalizePost(target.postId);
  revalidatePath('/ready');
  revalidatePath('/posts');
  revalidatePath('/calendar');
  return {};
}

/** Not posting this one after all; it counts as failed so "Retry failed channels" can bring it back. */
export async function skipManualTarget(form: FormData) {
  const { org } = await requireOrg();
  const target = await db.postTarget.findFirst({
    where: { id: String(form.get('targetId')), status: 'READY', post: { orgId: org.id } },
    select: { id: true, postId: true },
  });
  if (!target) return;
  await db.postTarget.update({ where: { id: target.id }, data: { status: 'FAILED', error: 'Skipped: not posted by hand' } });
  await finalizePost(target.postId);
  revalidatePath('/ready');
  revalidatePath('/posts');
  revalidatePath('/calendar');
}
