import type { ChannelCredentials, CredentialsProvider, InboxEntry, MediaFile, Metrics } from './types';
import { ReconnectRequiredError } from './types';
import { htmlToText } from '../text';

// A bare hostname: the server makes requests to it, so no schemes, ports, paths or IP-only hosts.
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function normalizeServer(input: string) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

// The handle is stored as "user@server", so the server can be recovered at publish time.
function serverOf(creds: ChannelCredentials) {
  return creds.handle.slice(creds.handle.lastIndexOf('@') + 1);
}

// The account id part of "<id>@<server>"
function accountIdOf(creds: ChannelCredentials) {
  return creds.externalId.slice(0, creds.externalId.lastIndexOf('@'));
}

interface Status {
  id: string;
  url: string | null;
  uri: string;
  content: string;
  created_at: string;
  in_reply_to_id: string | null;
  account: { id: string; acct: string; display_name: string; username: string };
}

function toEntry(kind: InboxEntry['kind'], status: Status): InboxEntry {
  return {
    kind,
    externalId: status.id,
    // url is null for some remote posts; uri is always a link to the original
    url: status.url ?? status.uri,
    authorName: status.account.display_name || status.account.username,
    authorHandle: status.account.acct,
    text: htmlToText(status.content),
    postedAt: new Date(status.created_at),
    inReplyTo: status.in_reply_to_id,
  };
}

async function api<T>(server: string, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://${server}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (res.status === 401 || res.status === 403) throw new ReconnectRequiredError('Mastodon rejected the access token');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mastodon ${res.status}: ${json.error ?? res.statusText}`);
  return json as T;
}

async function uploadMedia(server: string, token: string, file: MediaFile) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file.data)], { type: file.mimeType }), 'image');
  let media = await api<{ id: string; url: string | null }>(server, token, '/api/v2/media', { method: 'POST', body: form });
  // Large files are processed asynchronously (url is null until ready); images are usually instant
  for (let i = 0; !media.url && i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    media = await api(server, token, `/api/v1/media/${media.id}`);
  }
  return media.id;
}

export const mastodon: CredentialsProvider = {
  id: 'mastodon',
  name: 'Mastodon',
  connectType: 'credentials',
  // Mastodon's default; some servers allow more, but 500 is safe everywhere
  maxLength: 500,
  maxImages: 4,
  supportsMetrics: true,
  credentialFields: [
    { name: 'server', label: 'Server', type: 'text', placeholder: 'mastodon.social' },
    {
      name: 'accessToken',
      label: 'Access token',
      type: 'password',
      help: 'On your server: Preferences → Development → New application, with scopes read:accounts, read:statuses, write:statuses and write:media. Copy "Your access token".',
    },
  ],

  async connect(fields) {
    const server = normalizeServer(fields.server ?? '');
    const token = fields.accessToken?.trim();
    if (!HOSTNAME.test(server)) throw new Error('Enter your server name, like mastodon.social');
    if (!token) throw new Error('Access token is required');

    const me = await api<{ id: string; username: string; display_name: string; avatar: string }>(
      server,
      token,
      '/api/v1/accounts/verify_credentials',
    );
    return {
      // Account ids are only unique per server
      externalId: `${me.id}@${server}`,
      name: me.display_name || me.username,
      handle: `${me.username}@${server}`,
      avatarUrl: me.avatar || null,
      accessToken: token,
    };
  },

  async publish(creds, text, media) {
    const server = serverOf(creds);
    const mediaIds = [];
    for (const file of media) mediaIds.push(await uploadMedia(server, creds.accessToken, file));

    const status = await api<{ id: string; url: string }>(server, creds.accessToken, '/api/v1/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: text, media_ids: mediaIds }),
    });
    return { externalId: status.id, url: status.url };
  },

  async fetchMetrics(creds, externalIds) {
    const server = serverOf(creds);
    const result: Record<string, Metrics> = {};
    // One request per post: the batch endpoint only exists on newer servers
    for (const id of externalIds) {
      try {
        const s = await api<{ favourites_count: number; reblogs_count: number; replies_count: number }>(
          server,
          creds.accessToken,
          `/api/v1/statuses/${id}`,
        );
        result[id] = { likes: s.favourites_count, reposts: s.reblogs_count, replies: s.replies_count, impressions: null };
      } catch (e) {
        if (e instanceof ReconnectRequiredError) throw e;
        // Deleted posts return 404; leave them out so they count as "not found"
      }
    }
    return result;
  },

  async fetchInbox(creds, since) {
    const server = serverOf(creds);
    const entries: InboxEntry[] = [];
    let maxId = '';
    // Mastodon has no separate "reply" notification: replies are mentions with in_reply_to_id set
    for (let page = 0; page < 4; page++) {
      const batch = await api<{ id: string; created_at: string; status?: Status }[]>(
        server,
        creds.accessToken,
        `/api/v1/notifications?types[]=mention&limit=40${maxId ? `&max_id=${maxId}` : ''}`,
      );
      for (const n of batch) {
        if (new Date(n.created_at) < since) return entries;
        if (n.status) entries.push(toEntry(n.status.in_reply_to_id ? 'reply' : 'mention', n.status));
      }
      if (batch.length < 40) break;
      maxId = batch[batch.length - 1].id;
    }
    return entries;
  },

  async searchPosts(creds, keyword, since) {
    const server = serverOf(creds);
    const q = encodeURIComponent(keyword);
    // Full-text search only covers posts the server has indexed (opt-in on many servers),
    // so single words are also looked up as a hashtag, which every server supports
    const results = await api<{ statuses: Status[] }>(server, creds.accessToken, `/api/v2/search?q=${q}&type=statuses&limit=40`);
    const statuses = [...results.statuses];
    if (/^[\p{L}\p{N}_]+$/u.test(keyword)) {
      statuses.push(...(await api<Status[]>(server, creds.accessToken, `/api/v1/timelines/tag/${q}?limit=40`)));
    }

    const ownId = accountIdOf(creds);
    const seen = new Set<string>();
    return statuses
      .filter((s) => s.account.id !== ownId && new Date(s.created_at) >= since && !seen.has(s.id) && seen.add(s.id))
      .map((s) => toEntry('keyword', s));
  },

  async reply(creds, externalId, text) {
    const server = serverOf(creds);
    const parent = await api<Status>(server, creds.accessToken, `/api/v1/statuses/${externalId}`);
    // Mastodon only notifies the author if the reply mentions them
    const mention = `@${parent.account.acct}`;
    const status = await api<{ id: string; url: string }>(server, creds.accessToken, '/api/v1/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: text.includes(mention) ? text : `${mention} ${text}`,
        in_reply_to_id: parent.id,
      }),
    });
    return { externalId: status.id, url: status.url };
  },
};
