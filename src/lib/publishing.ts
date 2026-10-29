import type PgBoss from 'pg-boss';
import { db } from './db';
import { getFreshCredentials, markNeedsReconnect } from './channels';
import { getProvider } from './providers';
import { ReconnectRequiredError, type PostOptions } from './providers/types';
import { createLogger } from './logger';
import { reserveSlot } from './pacing';
import { readUpload } from './storage';

const log = createLogger('publishing');

export const PUBLISH_QUEUE = 'publish-target';
export const METRICS_QUEUE = 'refresh-metrics';

export interface PublishJob {
  targetId: string;
}

/**
 * Moves due SCHEDULED posts to PUBLISHING and enqueues one job per channel.
 * The web app only writes Post rows, so editing or unscheduling a post before
 * it is due needs no queue bookkeeping.
 */
export async function dispatchDuePosts(boss: PgBoss) {
  const due = await db.post.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { scheduledAt: 'asc' },
    take: 50,
  });

  for (const { id } of due) {
    // Claim the post so a second worker can't dispatch it too
    const claimed = await db.post.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: { status: 'PUBLISHING' },
    });
    if (claimed.count === 0) continue;

    const targets = await db.postTarget.findMany({
      where: { postId: id, status: 'PENDING' },
      select: { id: true, channelId: true, channel: { select: { provider: true } } },
    });
    let delayed = 0;
    let manual = 0;
    for (const target of targets) {
      const provider = getProvider(target.channel.provider);
      // Posted by hand: no job, just hand it to a person in "Ready to post"
      if (provider.connectType === 'manual') {
        await db.postTarget.update({ where: { id: target.id }, data: { status: 'READY', readyAt: new Date() } });
        manual++;
        continue;
      }
      // Channels with a pace limit get the next free slot; the job waits in the queue until then
      const pace = provider.pace;
      const slot = pace ? await reserveSlot(target.id, target.channelId, pace) : null;
      if (slot && slot.getTime() > Date.now()) delayed++;
      await boss.send(PUBLISH_QUEUE, { targetId: target.id } satisfies PublishJob, {
        singletonKey: target.id,
        retryLimit: 3,
        retryDelay: 60,
        retryBackoff: true,
        ...(slot ? { startAfter: slot } : {}),
      });
    }
    log.info('dispatched post', { postId: id, channels: targets.length, delayedByPace: delayed, readyToPostByHand: manual });
    if (targets.length === 0) await finalizePost(id);
  }
}

/** Publishes one post to one channel. Throws to let pg-boss retry, unless this is the last attempt. */
export async function publishTarget(targetId: string, isLastAttempt: boolean) {
  const target = await db.postTarget.findUnique({
    where: { id: targetId },
    include: {
      channel: true,
      post: { include: { media: { include: { media: true }, orderBy: { position: 'asc' } } } },
    },
  });
  if (!target || target.status !== 'PENDING') return;

  const { channel, post } = target;
  try {
    const provider = getProvider(channel.provider);
    const creds = await getFreshCredentials(channel);
    const media = await Promise.all(
      post.media.slice(0, provider.maxImages).map(async ({ media }) => ({
        data: await readUpload(post.orgId, media.fileName),
        mimeType: media.mimeType,
      })),
    );

    if (!provider.publish) throw new Error(`${provider.name} channels can't publish posts`);
    const result = await provider.publish(creds, post.content, media, (target.options ?? {}) as PostOptions);
    await db.postTarget.update({
      where: { id: target.id },
      data: {
        status: 'PUBLISHED',
        externalId: result.externalId,
        externalUrl: result.url,
        error: null,
        publishedAt: new Date(),
      },
    });
    log.info('published', { postId: post.id, targetId: target.id, provider: channel.provider, url: result.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const reconnect = e instanceof ReconnectRequiredError;
    const fields = { postId: post.id, targetId: target.id, provider: channel.provider, error: message };
    if (reconnect) await markNeedsReconnect(channel.id);

    if (!reconnect && !isLastAttempt) {
      log.warn('publish failed, will retry', fields);
      await db.postTarget.update({ where: { id: target.id }, data: { error: `Retrying: ${message}` } });
      throw e;
    }
    log.error(reconnect ? 'publish failed, channel needs reconnecting' : 'publish failed, giving up', fields);
    await db.postTarget.update({ where: { id: target.id }, data: { status: 'FAILED', error: message } });
  }

  await finalizePost(post.id);
}

/** Once every channel has finished, roll the outcome up to the post. */
export async function finalizePost(postId: string) {
  const targets = await db.postTarget.findMany({ where: { postId }, select: { status: true } });
  // READY targets are waiting for a person to post them by hand
  if (targets.some((t) => t.status === 'PENDING' || t.status === 'READY')) return;

  const published = targets.filter((t) => t.status === 'PUBLISHED').length;
  const status = published === targets.length ? 'PUBLISHED' : published === 0 ? 'FAILED' : 'PARTIAL';
  await db.post.update({ where: { id: postId }, data: { status } });
  log.info('post finished', { postId, status, published, channels: targets.length });
}

/** Pulls fresh like/repost/reply counts for posts published in the last 30 days (optionally one org). */
export async function refreshMetrics(orgId?: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const channels = await db.channel.findMany({
    where: {
      ...(orgId ? { orgId } : {}),
      needsReconnect: false,
      targets: { some: { status: 'PUBLISHED', publishedAt: { gte: since } } },
    },
    include: {
      targets: {
        where: { status: 'PUBLISHED', publishedAt: { gte: since }, externalId: { not: null } },
        select: { id: true, externalId: true },
      },
    },
  });

  for (const channel of channels) {
    const provider = getProvider(channel.provider);
    if (!provider.supportsMetrics || !provider.fetchMetrics) continue;
    try {
      const creds = await getFreshCredentials(channel);
      const metrics = await provider.fetchMetrics(creds, channel.targets.map((t) => t.externalId!));
      const rows = channel.targets
        .filter((t) => metrics[t.externalId!])
        .map((t) => ({ targetId: t.id, ...metrics[t.externalId!] }));
      if (rows.length) await db.metricSnapshot.createMany({ data: rows });
      log.info('metrics refreshed', { provider: channel.provider, channelId: channel.id, posts: rows.length });
    } catch (e) {
      if (e instanceof ReconnectRequiredError) await markNeedsReconnect(channel.id);
      log.error('metrics refresh failed', { provider: channel.provider, channelId: channel.id, error: e });
    }
  }
}
