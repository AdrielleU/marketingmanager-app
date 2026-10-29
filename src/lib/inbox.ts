import type { Channel, InboxKind } from '@prisma/client';
import { db } from './db';
import { getFreshCredentials, markNeedsReconnect } from './channels';
import { decrypt } from './crypto';
import { getProvider } from './providers';
import { sources, isSourceId } from './sources';
import { ReconnectRequiredError, type InboxEntry } from './providers/types';
import type { FeedEntry } from './sources/types';
import type { Prisma } from '@prisma/client';
import { createLogger } from './logger';

const log = createLogger('inbox');

export const INBOX_QUEUE = 'inbox-sync';
export const INBOX_CRON = '*/5 * * * *';

// Each sync re-reads a window that overlaps the last one instead of tracking per-source cursors;
// the unique (orgId, provider, externalId) key drops what we already have.
const NOTIFICATIONS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const SEARCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 5000;
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // matches INBOX_CRON

// Stateless "every N minutes": true on the sync that crosses an N-minute boundary
export function searchDue(everyMinutes: number | undefined, now: number) {
  if (!everyMinutes) return true;
  const period = everyMinutes * 60 * 1000;
  return Math.floor(now / period) !== Math.floor((now - SYNC_INTERVAL_MS) / period);
}

const KIND: Record<InboxEntry['kind'], InboxKind> = { reply: 'REPLY', mention: 'MENTION', keyword: 'KEYWORD' };

/** Where items came from: a connected channel (replies can be linked and answered) or a listen-only feed. */
type Origin = { orgId: string; provider: string; channelId?: string; feedId?: string };

// Replies and mentions are people talking to us directly, so they get a draft without asking
const AUTO_DRAFT_KINDS = new Set<InboxEntry['kind']>(['reply', 'mention']);

export function draftsEnabled() {
  return process.env.DRAFTS_WITH_CLAUDE_CLI === 'true';
}

async function save(origin: Origin, entries: (InboxEntry | FeedEntry)[], watchId: string | null = null) {
  if (entries.length === 0) return 0;

  // Link replies to the post of ours they answer, when it was published from this app
  const parents = [...new Set(entries.map((e) => e.inReplyTo).filter((id): id is string => Boolean(id)))];
  const targets =
    origin.channelId && parents.length
      ? await db.postTarget.findMany({
          where: { channelId: origin.channelId, externalId: { in: parents } },
          select: { id: true, externalId: true },
        })
      : [];
  const targetByExternalId = new Map(targets.map((t) => [t.externalId, t.id]));

  const { count } = await db.inboxItem.createMany({
    data: entries.map((e) => ({
      orgId: origin.orgId,
      channelId: origin.channelId ?? null,
      feedId: origin.feedId ?? null,
      // A feed entry can be about a platform (a Reddit notification email), so it files under that platform
      provider: ('provider' in e && e.provider) || origin.provider,
      threadKey: ('threadKey' in e && e.threadKey) || null,
      kind: KIND[e.kind],
      externalId: e.externalId,
      url: e.url,
      authorName: e.authorName.slice(0, 200),
      authorHandle: e.authorHandle.slice(0, 200),
      text: e.text.slice(0, MAX_TEXT),
      postedAt: e.postedAt,
      targetId: (e.inReplyTo && targetByExternalId.get(e.inReplyTo)) || null,
      watchId,
      draftStatus: draftsEnabled() && AUTO_DRAFT_KINDS.has(e.kind) ? ('REQUESTED' as const) : null,
    })),
    skipDuplicates: true,
  });
  return count;
}

const channelOrigin = (c: Channel): Origin => ({ orgId: c.orgId, provider: c.provider, channelId: c.id });

async function handleFailure(channel: Channel, what: string, e: unknown) {
  if (e instanceof ReconnectRequiredError) await markNeedsReconnect(channel.id);
  log.error(`${what} failed`, { provider: channel.provider, channelId: channel.id, error: e });
}

/** Pulls replies/mentions for every channel, then runs each org's keyword watches. */
export async function syncInbox() {
  const channels = await db.channel.findMany({ where: { needsReconnect: false }, orderBy: { createdAt: 'asc' } });
  const watches = await db.watch.findMany({ select: { id: true, orgId: true, keyword: true } });
  const now = Date.now();

  for (const channel of channels) {
    const provider = getProvider(channel.provider);
    if (!provider.fetchInbox) continue;
    try {
      const creds = await getFreshCredentials(channel);
      const added = await save(channelOrigin(channel), await provider.fetchInbox(creds, new Date(now - NOTIFICATIONS_WINDOW_MS)));
      if (added) log.info('inbox updated', { provider: channel.provider, channelId: channel.id, added });
    } catch (e) {
      await handleFailure(channel, 'inbox fetch', e);
    }
  }

  // Search is public, so one channel per org and channel type is enough (the oldest one)
  const searchers = new Map<string, Channel>();
  for (const channel of channels) {
    const key = `${channel.orgId}:${channel.provider}`;
    if (getProvider(channel.provider).searchPosts && !searchers.has(key)) searchers.set(key, channel);
  }

  for (const channel of searchers.values()) {
    const orgWatches = watches.filter((w) => w.orgId === channel.orgId);
    if (orgWatches.length === 0) continue;
    const provider = getProvider(channel.provider);
    if (!searchDue(provider.searchEveryMinutes, now)) continue;
    try {
      const creds = await getFreshCredentials(channel);
      for (const watch of orgWatches) {
        const entries = await provider.searchPosts!(creds, watch.keyword, new Date(now - SEARCH_WINDOW_MS));
        const added = await save(channelOrigin(channel), entries, watch.id);
        if (added) log.info('keyword matches', { provider: channel.provider, watchId: watch.id, added });
      }
    } catch (e) {
      await handleFailure(channel, 'keyword search', e);
    }
  }

  const feeds = await db.feed.findMany({
    select: { id: true, orgId: true, sourceId: true, url: true, secret: true, state: true },
  });
  for (const feed of feeds) {
    if (!isSourceId(feed.sourceId)) continue;
    try {
      const config = { url: feed.url, secret: feed.secret ? decrypt(feed.secret) : null, state: feed.state };
      const { entries, state } = await sources[feed.sourceId].fetchEntries(config, new Date(now - NOTIFICATIONS_WINDOW_MS));
      const added = await save({ orgId: feed.orgId, provider: feed.sourceId, feedId: feed.id }, entries);
      // Save the cursor only after the items are stored, so a crash re-reads instead of skipping
      await db.feed.update({
        where: { id: feed.id },
        data: { error: null, ...(state !== undefined ? { state: state as Prisma.InputJsonValue } : {}) },
      });
      if (added) log.info('feed updated', { source: feed.sourceId, feedId: feed.id, added });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.feed.update({ where: { id: feed.id }, data: { error: message.slice(0, 500) } });
      log.error('feed fetch failed', { source: feed.sourceId, feedId: feed.id, error: e });
    }
  }
}

/** Sends replies written in the app. Called on the worker's dispatch tick. */
export async function sendPendingReplies() {
  const pending = await db.inboxItem.findMany({
    where: { replyStatus: 'PENDING' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  for (const { id } of pending) {
    // Claim it so a second worker can't send the same reply
    const claimed = await db.inboxItem.updateMany({ where: { id, replyStatus: 'PENDING' }, data: { replyStatus: 'SENDING' } });
    if (claimed.count === 0) continue;

    const item = await db.inboxItem.findUniqueOrThrow({ where: { id }, include: { channel: true } });
    try {
      if (!item.channel) throw new Error('Items from feeds can only be answered on the site itself');
      const provider = getProvider(item.provider);
      if (!provider.reply) throw new Error(`${provider.name} doesn't support replying from the app`);
      const creds = await getFreshCredentials(item.channel);
      const result = await provider.reply(creds, item.externalId, item.replyText ?? '');
      await db.inboxItem.update({
        where: { id },
        data: { replyStatus: 'SENT', replyUrl: result.url, replyError: null, repliedAt: new Date(), status: 'READ' },
      });
      log.info('reply sent', { itemId: id, provider: item.provider });
    } catch (e) {
      if (e instanceof ReconnectRequiredError && item.channelId) await markNeedsReconnect(item.channelId);
      const message = e instanceof Error ? e.message : String(e);
      await db.inboxItem.update({ where: { id }, data: { replyStatus: 'FAILED', replyError: message } });
      log.error('reply failed', { itemId: id, provider: item.provider, error: e });
    }
  }
}

/**
 * A reply stuck in SENDING means a worker stopped mid-send. It may or may not have been posted,
 * so mark it failed rather than resending and risking a duplicate. The age check leaves alone
 * replies another running worker is sending right now.
 */
export async function recoverInterruptedReplies() {
  const { count } = await db.inboxItem.updateMany({
    where: { replyStatus: 'SENDING', updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
    data: { replyStatus: 'FAILED', replyError: 'Interrupted while sending. Check the platform before trying again.' },
  });
  if (count) log.warn('marked interrupted replies as failed', { count });
}
