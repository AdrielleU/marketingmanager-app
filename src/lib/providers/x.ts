import type { ChannelCredentials, ConnectedAccount, Metrics, OAuthProvider } from './types';
import { ReconnectRequiredError } from './types';

const API = 'https://api.x.com/2';
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];

function basicAuth() {
  const id = process.env.X_CLIENT_ID ?? '';
  const secret = process.env.X_CLIENT_SECRET ?? '';
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth() },
    body: new URLSearchParams({ client_id: process.env.X_CLIENT_ID ?? '', ...body }),
  });
  const json = await res.json();
  if (!res.ok) {
    if (body.grant_type === 'refresh_token') throw new ReconnectRequiredError('X refresh token was rejected');
    throw new Error(`X token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return {
    accessToken: json.access_token as string,
    refreshToken: (json.refresh_token as string) ?? null,
    tokenExpiresAt: new Date(Date.now() + Number(json.expires_in ?? 7200) * 1000),
  };
}

async function api<T>(creds: ChannelCredentials, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${creds.accessToken}`, ...init.headers },
  });
  if (res.status === 401) throw new ReconnectRequiredError('X rejected the access token');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.detail ?? json.title ?? json.errors?.[0]?.message ?? res.statusText;
    throw new Error(`X API ${res.status}: ${detail}`);
  }
  return json as T;
}

async function uploadMedia(creds: ChannelCredentials, data: Buffer, mimeType: string) {
  const form = new FormData();
  form.append('media', new Blob([new Uint8Array(data)], { type: mimeType }));
  form.append('media_category', mimeType === 'image/gif' ? 'tweet_gif' : 'tweet_image');
  const json = await api<{ data: { id: string } }>(creds, '/media/upload', { method: 'POST', body: form });
  return json.data.id;
}

export const x: OAuthProvider = {
  id: 'x',
  name: 'X',
  connectType: 'oauth',
  maxLength: 280,
  maxImages: 4,
  supportsMetrics: true,
  // X's automation rules forbid duplicate posts and bulk posting; it also rejects exact repeats
  pace: { minMinutesBetween: 5, maxPerDay: 50 },
  duplicateWindowDays: 30,

  isConfigured: () => Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),

  authorizeUrl({ state, redirectUri, codeChallenge }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.X_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://x.com/i/oauth2/authorize?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier }): Promise<ConnectedAccount> {
    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const me = await api<{ data: { id: string; name: string; username: string; profile_image_url?: string } }>(
      { externalId: '', handle: '', refreshToken: null, tokenExpiresAt: null, accessToken: tokens.accessToken },
      '/users/me?user.fields=profile_image_url',
    );
    return {
      externalId: me.data.id,
      name: me.data.name,
      handle: me.data.username,
      avatarUrl: me.data.profile_image_url ?? null,
      ...tokens,
    };
  },

  async refresh(creds) {
    const expiresSoon = !creds.tokenExpiresAt || creds.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;
    if (!expiresSoon) return null;
    if (!creds.refreshToken) throw new ReconnectRequiredError('X access expired and there is no refresh token');
    return tokenRequest({ grant_type: 'refresh_token', refresh_token: creds.refreshToken });
  },

  async publish(creds, text, media) {
    const mediaIds = [];
    for (const file of media) mediaIds.push(await uploadMedia(creds, file.data, file.mimeType));

    const json = await api<{ data: { id: string } }>(creds, '/tweets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
    });
    return { externalId: json.data.id, url: `https://x.com/${creds.handle}/status/${json.data.id}` };
  },

  async fetchMetrics(creds, externalIds) {
    const result: Record<string, Metrics> = {};
    for (let i = 0; i < externalIds.length; i += 100) {
      const ids = externalIds.slice(i, i + 100).join(',');
      const json = await api<{
        data?: { id: string; public_metrics: Record<string, number> }[];
      }>(creds, `/tweets?ids=${ids}&tweet.fields=public_metrics`);
      for (const tweet of json.data ?? []) {
        const m = tweet.public_metrics;
        result[tweet.id] = {
          likes: m.like_count ?? 0,
          reposts: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
          replies: m.reply_count ?? 0,
          impressions: m.impression_count ?? null,
        };
      }
    }
    return result;
  },
};
