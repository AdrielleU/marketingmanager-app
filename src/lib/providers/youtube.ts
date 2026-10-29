import type { ChannelCredentials, ConnectedAccount, InboxEntry, OAuthProvider } from './types';
import { ReconnectRequiredError } from './types';

const API = 'https://www.googleapis.com/youtube/v3';
// force-ssl covers reading comments, searching and posting comment replies
const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];
// Keyword results are videos; we comment on those, but reply to comments. The prefix tells them apart.
const VIDEO_PREFIX = 'video:';

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
      client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
      ...body,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.grant_type === 'refresh_token') throw new ReconnectRequiredError('Google refresh token was rejected');
    throw new Error(`Google token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return {
    accessToken: json.access_token as string,
    // Google only returns a refresh token on the first consent; refreshes keep the existing one
    refreshToken: (json.refresh_token as string) ?? null,
    tokenExpiresAt: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000),
  };
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (res.status === 401) throw new ReconnectRequiredError('YouTube rejected the access token');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json.error?.errors?.[0]?.reason;
    // The daily quota is per Google Cloud project and resets at midnight Pacific time
    if (reason === 'quotaExceeded') throw new Error('YouTube API daily quota used up; it resets at midnight Pacific time');
    throw new Error(`YouTube API ${res.status}: ${json.error?.message ?? res.statusText}`);
  }
  return json as T;
}

interface Comment {
  id: string;
  snippet: {
    videoId?: string;
    textOriginal: string;
    authorDisplayName: string;
    authorChannelId?: { value: string };
    publishedAt: string;
  };
}

function commentEntry(comment: Comment, videoId: string, parentId: string | null): InboxEntry {
  const name = comment.snippet.authorDisplayName;
  return {
    kind: 'reply',
    externalId: comment.id,
    url: `https://www.youtube.com/watch?v=${videoId}&lc=${comment.id}`,
    authorName: name.replace(/^@/, ''),
    authorHandle: name.replace(/^@/, ''),
    text: comment.snippet.textOriginal,
    postedAt: new Date(comment.snippet.publishedAt),
    inReplyTo: parentId ?? videoId,
  };
}

export const youtube: OAuthProvider = {
  id: 'youtube',
  name: 'YouTube',
  connectType: 'oauth',
  // No publish: video and Shorts upload needs video support in the media pipeline. Comments only for now.
  maxLength: 10_000,
  maxImages: 0,
  supportsMetrics: false,
  // A search costs 100 of the project's 10,000 free daily quota units, shared by every connected account
  searchEveryMinutes: 180,

  isConfigured: () => Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),

  authorizeUrl({ state, redirectUri, codeChallenge }) {
    const params = new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // offline + consent: always get a refresh token, even when reconnecting
      access_type: 'offline',
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier }): Promise<ConnectedAccount> {
    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const json = await api<{
      items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[];
    }>(tokens.accessToken, '/channels?part=snippet&mine=true');
    const channel = json.items?.[0];
    if (!channel) throw new Error('This Google account has no YouTube channel');
    return {
      externalId: channel.id,
      name: channel.snippet.title,
      handle: (channel.snippet.customUrl ?? channel.id).replace(/^@/, ''),
      avatarUrl: channel.snippet.thumbnails?.default?.url ?? null,
      ...tokens,
    };
  },

  async refresh(creds) {
    const expiresSoon = !creds.tokenExpiresAt || creds.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;
    if (!expiresSoon) return null;
    if (!creds.refreshToken) throw new ReconnectRequiredError('YouTube access expired and there is no refresh token');
    return tokenRequest({ grant_type: 'refresh_token', refresh_token: creds.refreshToken });
  },

  // Comments on the channel's videos and Shorts (1 quota unit per call)
  async fetchInbox(creds: ChannelCredentials, since) {
    const json = await api<{
      items: { snippet: { videoId: string; topLevelComment: Comment }; replies?: { comments: Comment[] } }[];
    }>(
      creds.accessToken,
      `/commentThreads?part=snippet,replies&allThreadsRelatedToChannelId=${creds.externalId}&order=time&maxResults=100&textFormat=plainText`,
    );
    const entries: InboxEntry[] = [];
    for (const thread of json.items) {
      const { videoId, topLevelComment } = thread.snippet;
      const fromUs = (c: Comment) => c.snippet.authorChannelId?.value === creds.externalId;
      if (!fromUs(topLevelComment)) entries.push(commentEntry(topLevelComment, videoId, null));
      for (const reply of thread.replies?.comments ?? []) {
        if (!fromUs(reply)) entries.push(commentEntry(reply, videoId, topLevelComment.id));
      }
    }
    return entries.filter((e) => e.postedAt >= since);
  },

  // Newest videos and Shorts matching the keyword (100 quota units per call)
  async searchPosts(creds, keyword, since) {
    const params = new URLSearchParams({
      part: 'snippet',
      q: keyword,
      type: 'video',
      order: 'date',
      maxResults: '25',
      publishedAfter: since.toISOString(),
    });
    const json = await api<{
      items: { id: { videoId: string }; snippet: { title: string; description: string; channelId: string; channelTitle: string; publishedAt: string } }[];
    }>(creds.accessToken, `/search?${params}`);
    return json.items
      .filter((v) => v.snippet.channelId !== creds.externalId)
      .map((v) => ({
        kind: 'keyword' as const,
        externalId: `${VIDEO_PREFIX}${v.id.videoId}`,
        url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
        authorName: v.snippet.channelTitle,
        authorHandle: v.snippet.channelTitle,
        text: v.snippet.description ? `${v.snippet.title}\n\n${v.snippet.description}` : v.snippet.title,
        postedAt: new Date(v.snippet.publishedAt),
      }));
  },

  async reply(creds, externalId, text) {
    if (externalId.startsWith(VIDEO_PREFIX)) {
      // A keyword match is a video: post a new top-level comment on it (50 quota units)
      const videoId = externalId.slice(VIDEO_PREFIX.length);
      const thread = await api<{ id: string }>(creds.accessToken, '/commentThreads?part=snippet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } }),
      });
      return { externalId: thread.id, url: `https://www.youtube.com/watch?v=${videoId}&lc=${thread.id}` };
    }

    // YouTube threads are one level deep: replies to a reply go on its top-level comment ("<parent>.<id>")
    const parentId = externalId.split('.')[0];
    const comment = await api<{ id: string }>(creds.accessToken, '/comments?part=snippet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
    });
    const thread = await api<{ items: { snippet: { videoId: string } }[] }>(
      creds.accessToken,
      `/commentThreads?part=snippet&id=${parentId}`,
    );
    const videoId = thread.items[0]?.snippet.videoId;
    return { externalId: comment.id, url: videoId ? `https://www.youtube.com/watch?v=${videoId}&lc=${comment.id}` : 'https://studio.youtube.com' };
  },
};
