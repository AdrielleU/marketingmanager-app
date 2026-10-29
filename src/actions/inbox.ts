'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireOrg } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { draftsEnabled } from '@/lib/inbox';
import { getProvider, isProviderId } from '@/lib/providers';
import { isSourceId, sources } from '@/lib/sources';
import type { FormState } from './auth';

const MAX_WATCHES = 25;

const watchSchema = z.object({ keyword: z.string().trim().min(2, 'Keywords need at least 2 characters').max(100) });

export async function addWatch(_: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrg();
  const parsed = watchSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { keyword } = parsed.data;

  const watches = await db.watch.findMany({ where: { orgId: org.id }, select: { keyword: true } });
  if (watches.some((w) => w.keyword.toLowerCase() === keyword.toLowerCase())) return { error: 'Already watching that keyword' };
  if (watches.length >= MAX_WATCHES) return { error: `You can watch up to ${MAX_WATCHES} keywords` };

  await db.watch.create({ data: { orgId: org.id, keyword }, select: { id: true } });
  revalidatePath('/inbox');
  return {};
}

export async function removeWatch(form: FormData) {
  const { org } = await requireOrg();
  await db.watch.deleteMany({ where: { id: String(form.get('watchId')), orgId: org.id } });
  revalidatePath('/inbox');
}

export async function setItemStatus(form: FormData) {
  const { org } = await requireOrg();
  const status = z.enum(['UNREAD', 'READ', 'ARCHIVED']).parse(form.get('status'));
  await db.inboxItem.updateMany({ where: { id: String(form.get('itemId')), orgId: org.id }, data: { status } });
  revalidatePath('/inbox');
}

const replySchema = z.object({ itemId: z.string(), text: z.string().trim().min(1, 'Write a reply first').max(10_000) });

export type ReplyResult = { ok: true } | { ok: false; error: string };

/** Queues a reply; the worker sends it on its next tick (the web app never calls platforms directly). */
export async function queueReply(input: z.infer<typeof replySchema>): Promise<ReplyResult> {
  const { org, user } = await requireOrg();
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { itemId, text } = parsed.data;

  const item = await db.inboxItem.findFirst({
    where: { id: itemId, orgId: org.id },
    select: { provider: true, channel: { select: { name: true, needsReconnect: true } } },
  });
  if (!item) return { ok: false, error: 'That item no longer exists' };
  if (!item.channel || !isProviderId(item.provider)) return { ok: false, error: 'Reply to this on the site itself' };
  const provider = getProvider(item.provider);
  if (!provider.reply) return { ok: false, error: `${provider.name} doesn't support replying from the app` };
  if (item.channel.needsReconnect) return { ok: false, error: `${item.channel.name} needs to be reconnected first` };
  if (text.length > provider.maxLength) return { ok: false, error: `${provider.name} allows ${provider.maxLength} characters` };

  // Only one reply per item; a failed one can be retried
  const queued = await db.inboxItem.updateMany({
    where: { id: itemId, orgId: org.id, OR: [{ replyStatus: null }, { replyStatus: 'FAILED' }] },
    data: { replyText: text, replyStatus: 'PENDING', replyError: null, repliedById: user.id, status: 'READ' },
  });
  if (queued.count === 0) return { ok: false, error: 'A reply to this is already sent or on its way' };

  revalidatePath('/inbox');
  return { ok: true };
}

const MAX_FEEDS = 25;

const feedSchema = z.object({
  sourceId: z.string(),
  label: z.string().trim().min(1, 'Give the feed a name').max(100),
});

export async function addFeed(_: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrg('ADMIN');
  const parsed = feedSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { sourceId, label } = parsed.data;
  if (!isSourceId(sourceId)) return { error: 'Unknown feed type' };
  const source = sources[sourceId];

  const fields: Record<string, string> = {};
  for (const field of source.fields) fields[field.name] = String(form.get(field.name) ?? '').slice(0, 500);

  if ((await db.feed.count({ where: { orgId: org.id } })) >= MAX_FEEDS) return { error: `You can add up to ${MAX_FEEDS} feeds` };

  let config: { url: string; secret?: string };
  try {
    config = await source.setup(fields);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not add the feed' };
  }
  if (await db.feed.findFirst({ where: { orgId: org.id, url: config.url }, select: { id: true } })) return { error: 'That feed is already added' };

  await db.feed.create({
    data: { orgId: org.id, sourceId, label, url: config.url, secret: config.secret ? encrypt(config.secret) : null },
    select: { id: true },
  });
  revalidatePath('/inbox');
  return {};
}

export async function removeFeed(form: FormData) {
  const { org } = await requireOrg('ADMIN');
  await db.feed.deleteMany({ where: { id: String(form.get('feedId')), orgId: org.id } });
  revalidatePath('/inbox');
}

export async function requestDraft(form: FormData) {
  const { org } = await requireOrg();
  if (!draftsEnabled()) return;
  await db.inboxItem.updateMany({
    where: { id: String(form.get('itemId')), orgId: org.id, NOT: { draftStatus: { in: ['REQUESTED', 'DRAFTING'] } } },
    data: { draftStatus: 'REQUESTED', draftError: null },
  });
  revalidatePath('/inbox');
}

/** Archives everything the current filters show (the Inbox's "Mark all done"). */
export async function markAllDone(form: FormData) {
  const { org } = await requireOrg();
  const kind = z.enum(['REPLY', 'MENTION', 'KEYWORD']).optional().catch(undefined).parse(form.get('kind') || undefined);
  const source = String(form.get('source') ?? '');
  const watch = String(form.get('watch') ?? '');
  await db.inboxItem.updateMany({
    where: {
      orgId: org.id,
      status: { not: 'ARCHIVED' },
      ...(source ? { provider: source } : {}),
      ...(kind ? { kind } : {}),
      ...(watch ? { watchId: watch } : {}),
    },
    data: { status: 'ARCHIVED' },
  });
  revalidatePath('/inbox');
}

export async function saveReplyGuidelines(_: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrg('ADMIN');
  const text = String(form.get('guidelines') ?? '').trim().slice(0, 5000);
  await db.organization.update({ where: { id: org.id }, data: { replyGuidelines: text || null }, select: { id: true } });
  revalidatePath('/inbox');
  return {};
}
