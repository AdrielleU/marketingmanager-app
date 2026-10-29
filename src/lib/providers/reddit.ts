import type { ChannelCredentials, ConnectedAccount, InboxEntry, Metrics, OAuthProvider } from './types';
import { ReconnectRequiredError } from './types';

const AUTH = 'https://www.reddit.com/api/v1';
const API = 'https://oauth.reddit.com';
// privatemessages: the inbox, where comment replies and u/ mentions arrive
const SCOPES = ['identity', 'submit', 'read', 'privatemessages'];
const SITE = 'https://www.reddit.com';

// Reddit rejects requests without a descriptive User-Agent
function userAgent() {
  return process.env.REDDIT_USER_AGENT || 'web:marketingmanager:0.1';
}

function basicAuth() {
  const id = process.env.REDDIT_CLIENT_ID ?? '';
  const secret = process.env.REDDIT_CLIENT_SECRET ?? '';
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${AUTH}/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(),
      'User-Agent': userAgent(),
    },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  // Reddit can report token errors with a 200 status, so check the body too
  if (!res.ok || json.error) {
    if (body.grant_type === 'refresh_token') throw new ReconnectRequiredError('Reddit refresh token was rejected');
    throw new Error(`Reddit token request failed: ${json.error ?? res.status}`);
  }
  return {
    accessToken: json.access_token as string,
    // Refreshing doesn't return a new refresh token; the existing one keeps working
    refreshToken: (json.refresh_token as string) ?? null,
    tokenExpiresAt: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000),
  };
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent(), ...init.headers },
  });
  if (res.status === 401) throw new ReconnectRequiredError('Reddit rejected the access token');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Reddit API ${res.status}: ${json.message ?? res.statusText}`);
  return json as T;
}

interface Listing<T> {
  data: { after: string | null; children: { kind: string; data: T }[] };
}

interface InboxMessage {
  name: string;
  author: string;
  body: string;
  created_utc: number;
  context: string;
  parent_id: string | null;
  type: string;
}

interface Link {
  name: string;
  author: string;
  title: string;
  selftext: string;
  created_utc: number;
  permalink: string;
}

export const reddit: OAuthProvider = {
  id: 'reddit',
  name: 'Reddit',
  connectType: 'oauth',
  maxLength: 40_000,
  // Image posts need Reddit's undocumented media upload flow, so only text posts for now
  maxImages: 0,
  supportsMetrics: true,
  // Reddit's spam filters punish frequent and repeated self-promotion, especially across subreddits
  pace: { minMinutesBetween: 10, maxPerDay: 10 },
  duplicateWindowDays: 30,
  postFields: [
    { name: 'subreddit', label: 'Subreddit', placeholder: 'r/yoursubreddit', maxLength: 50, required: true },
    { name: 'title', label: 'Title', placeholder: 'Post title', maxLength: 300, required: true },
  ],

  isConfigured: () => Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),

  // Reddit doesn't support PKCE, so the code challenge is unused; state still protects the callback
  authorizeUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: process.env.REDDIT_CLIENT_ID ?? '',
      response_type: 'code',
      state,
      redirect_uri: redirectUri,
      duration: 'permanent',
      scope: SCOPES.join(' '),
    });
    return `${AUTH}/authorize?${params}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<ConnectedAccount> {
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const me = await api<{ id: string; name: string; icon_img?: string }>(tokens.accessToken, '/api/v1/me');
    return {
      externalId: me.id,
      name: `u/${me.name}`,
      handle: me.name,
      // Reddit HTML-escapes the query string in avatar URLs
      avatarUrl: me.icon_img ? me.icon_img.replace(/&amp;/g, '&') : null,
      ...tokens,
    };
  },

  async refresh(creds) {
    const expiresSoon = !creds.tokenExpiresAt || creds.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;
    if (!expiresSoon) return null;
    if (!creds.refreshToken) throw new ReconnectRequiredError('Reddit access expired and there is no refresh token');
    return tokenRequest({ grant_type: 'refresh_token', refresh_token: creds.refreshToken });
  },

  async publish(creds: ChannelCredentials, text, _media, options) {
    const subreddit = (options.subreddit ?? '').trim().replace(/^\/?r\//i, '');
    const title = (options.title ?? '').trim();
    if (!subreddit || !title) throw new Error('Reddit posts need a subreddit and a title');

    const json = await api<{
      json: { errors: [string, string, string][]; data?: { name: string; url: string } };
    }>(creds.accessToken, '/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_type: 'json', kind: 'self', sr: subreddit, title, text }),
    });
    const [error] = json.json.errors;
    if (error || !json.json.data) throw new Error(`Reddit: ${error ? `${error[1]} (${error[0]})` : 'submit failed'}`);
    // "name" is the fullname (t3_…), which is what /api/info takes for metrics
    return { externalId: json.json.data.name, url: json.json.data.url };
  },

  async fetchMetrics(creds, externalIds) {
    const result: Record<string, Metrics> = {};
    for (let i = 0; i < externalIds.length; i += 100) {
      const ids = externalIds.slice(i, i + 100).join(',');
      const json = await api<{
        data: { children: { data: { name: string; score: number; num_comments: number; num_crossposts: number } }[] };
      }>(creds.accessToken, `/api/info?id=${ids}`);
      for (const { data } of json.data.children) {
        result[data.name] = {
          likes: data.score,
          reposts: data.num_crossposts,
          replies: data.num_comments,
          impressions: null,
        };
      }
    }
    return result;
  },

  async fetchInbox(creds, since) {
    const json = await api<Listing<InboxMessage>>(creds.accessToken, '/message/inbox?limit=100&raw_json=1');
    return json.data.children
      // t1 = comments (replies and mentions); t4 private messages aren't part of the inbox here
      .filter((c) => c.kind === 't1' && c.data.created_utc * 1000 >= since.getTime())
      .map(({ data }) => ({
        kind: data.type === 'username_mention' ? ('mention' as const) : ('reply' as const),
        externalId: data.name,
        url: `${SITE}${data.context}`,
        authorName: `u/${data.author}`,
        authorHandle: data.author,
        text: data.body,
        postedAt: new Date(data.created_utc * 1000),
        inReplyTo: data.parent_id,
      }));
  },

  async searchPosts(creds, keyword, since) {
    // Reddit's API searches posts only, not comments
    const q = encodeURIComponent(keyword);
    const json = await api<Listing<Link>>(creds.accessToken, `/search?q=${q}&sort=new&type=link&limit=100&raw_json=1`);
    const entries: InboxEntry[] = [];
    for (const { data } of json.data.children) {
      if (data.created_utc * 1000 < since.getTime()) break; // sorted newest first
      if (data.author === creds.handle) continue;
      entries.push({
        kind: 'keyword',
        externalId: data.name,
        url: `${SITE}${data.permalink}`,
        authorName: `u/${data.author}`,
        authorHandle: data.author,
        text: data.selftext ? `${data.title}\n\n${data.selftext}` : data.title,
        postedAt: new Date(data.created_utc * 1000),
      });
    }
    return entries;
  },

  async reply(creds, externalId, text) {
    const json = await api<{
      json: { errors: [string, string, string][]; data?: { things: { data: { name: string; permalink: string } }[] } };
    }>(creds.accessToken, '/api/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_type: 'json', thing_id: externalId, text }),
    });
    const [error] = json.json.errors;
    const comment = json.json.data?.things[0]?.data;
    if (error || !comment) throw new Error(`Reddit: ${error ? `${error[1]} (${error[0]})` : 'reply failed'}`);
    return { externalId: comment.name, url: `${SITE}${comment.permalink}` };
  },
};
