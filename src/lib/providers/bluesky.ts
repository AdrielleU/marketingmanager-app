import { AtpAgent, RichText } from '@atproto/api';
import type { ChannelCredentials, CredentialsProvider, InboxEntry, Metrics } from './types';
import { ReconnectRequiredError } from './types';

const SERVICE = 'https://bsky.social';

// Logging in creates a session and is rate limited, so keep one agent per account per process.
const agents = new Map<string, AtpAgent>();

async function login(identifier: string, appPassword: string) {
  const agent = new AtpAgent({ service: SERVICE });
  try {
    await agent.login({ identifier, password: appPassword });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/invalid identifier or password|AuthenticationRequired/i.test(message)) {
      throw new ReconnectRequiredError('Bluesky rejected the handle or app password');
    }
    throw e;
  }
  return agent;
}

async function agentFor(creds: ChannelCredentials) {
  const cached = agents.get(creds.externalId);
  if (cached?.session) return cached;
  const agent = await login(creds.handle, creds.accessToken);
  agents.set(creds.externalId, agent);
  return agent;
}

function postUrl(handle: string, uri: string) {
  const rkey = uri.split('/').pop();
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

// Notifications are newest first; a few pages covers a sync interval of minutes with room to spare
const INBOX_PAGES = 4;

type PostRecord = { text?: string; createdAt?: string; reply?: { root: { uri: string; cid: string }; parent?: { uri: string } } };

export const bluesky: CredentialsProvider = {
  id: 'bluesky',
  name: 'Bluesky',
  connectType: 'credentials',
  maxLength: 300,
  maxImages: 4,
  supportsMetrics: true,
  credentialFields: [
    { name: 'identifier', label: 'Handle', type: 'text', placeholder: 'you.bsky.social' },
    {
      name: 'appPassword',
      label: 'App password',
      type: 'password',
      placeholder: 'xxxx-xxxx-xxxx-xxxx',
      help: 'Create one in Bluesky under Settings → Privacy and security → App passwords. Never use your main password.',
    },
  ],

  async connect(fields) {
    const identifier = fields.identifier?.trim().replace(/^@/, '');
    const appPassword = fields.appPassword?.trim();
    if (!identifier || !appPassword) throw new Error('Handle and app password are required');

    const agent = await login(identifier, appPassword);
    const did = agent.session!.did;
    const { data: profile } = await agent.getProfile({ actor: did });
    agents.set(did, agent);

    return {
      externalId: did,
      name: profile.displayName || profile.handle,
      handle: profile.handle,
      avatarUrl: profile.avatar ?? null,
      // Bluesky has no OAuth for this flow; the app password is the credential (stored encrypted)
      accessToken: appPassword,
    };
  },

  async publish(creds, text, media) {
    const agent = await agentFor(creds);
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    const images = [];
    for (const file of media) {
      const { data } = await agent.uploadBlob(file.data, { encoding: file.mimeType });
      images.push({ image: data.blob, alt: '' });
    }

    const res = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      ...(images.length ? { embed: { $type: 'app.bsky.embed.images', images } } : {}),
    });

    return { externalId: res.uri, url: postUrl(agent.session?.handle ?? creds.handle, res.uri) };
  },

  async fetchMetrics(creds, externalIds) {
    const agent = await agentFor(creds);
    const result: Record<string, Metrics> = {};
    for (let i = 0; i < externalIds.length; i += 25) {
      const { data } = await agent.getPosts({ uris: externalIds.slice(i, i + 25) });
      for (const post of data.posts) {
        result[post.uri] = {
          likes: post.likeCount ?? 0,
          reposts: (post.repostCount ?? 0) + (post.quoteCount ?? 0),
          replies: post.replyCount ?? 0,
          impressions: null,
        };
      }
    }
    return result;
  },

  async fetchInbox(creds, since) {
    const agent = await agentFor(creds);
    const entries: InboxEntry[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < INBOX_PAGES; page++) {
      const { data } = await agent.listNotifications({ reasons: ['reply', 'mention', 'quote'], limit: 50, cursor });
      for (const n of data.notifications) {
        if (new Date(n.indexedAt) < since) return entries;
        const record = n.record as PostRecord;
        entries.push({
          kind: n.reason === 'reply' ? 'reply' : 'mention',
          externalId: n.uri,
          url: postUrl(n.author.handle, n.uri),
          authorName: n.author.displayName || n.author.handle,
          authorHandle: n.author.handle,
          text: record.text ?? '',
          postedAt: new Date(record.createdAt ?? n.indexedAt),
          inReplyTo: record.reply?.parent?.uri ?? null,
        });
      }
      if (!data.cursor) break;
      cursor = data.cursor;
    }
    return entries;
  },

  async searchPosts(creds, keyword, since) {
    const agent = await agentFor(creds);
    const { data } = await agent.app.bsky.feed.searchPosts({ q: keyword, sort: 'latest', since: since.toISOString(), limit: 50 });
    return data.posts
      .filter((p) => p.author.did !== creds.externalId)
      .map((p) => {
        const record = p.record as PostRecord;
        return {
          kind: 'keyword' as const,
          externalId: p.uri,
          url: postUrl(p.author.handle, p.uri),
          authorName: p.author.displayName || p.author.handle,
          authorHandle: p.author.handle,
          text: record.text ?? '',
          postedAt: new Date(record.createdAt ?? p.indexedAt),
        };
      });
  },

  async reply(creds, externalId, text) {
    const agent = await agentFor(creds);
    const { data } = await agent.getPosts({ uris: [externalId] });
    const parent = data.posts[0];
    if (!parent) throw new Error('The post you are replying to no longer exists');

    // A reply points at its direct parent and at the thread's first post
    const parentRef = { uri: parent.uri, cid: parent.cid };
    const root = (parent.record as PostRecord).reply?.root ?? parentRef;
    const rt = new RichText({ text });
    await rt.detectFacets(agent);
    const res = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      reply: { root, parent: parentRef },
    });
    return { externalId: res.uri, url: postUrl(agent.session?.handle ?? creds.handle, res.uri) };
  },
};
