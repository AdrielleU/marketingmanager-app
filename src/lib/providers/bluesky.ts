import { AtpAgent, RichText } from '@atproto/api';
import type { ChannelCredentials, CredentialsProvider, Metrics } from './types';
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
};
