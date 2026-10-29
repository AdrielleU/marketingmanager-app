import type { ChannelCredentials, ConnectedAccount, OAuthProvider } from './types';
import { ReconnectRequiredError } from './types';

const SCOPES = ['openid', 'profile', 'w_member_social'];

function restHeaders(creds: ChannelCredentials) {
  return {
    Authorization: `Bearer ${creds.accessToken}`,
    'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202509',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

async function check(res: Response, what: string) {
  if (res.status === 401) throw new ReconnectRequiredError('LinkedIn rejected the access token');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`LinkedIn ${what} failed (${res.status}): ${body.message ?? res.statusText}`);
  }
  return res;
}

// LinkedIn "little text" format treats these characters as markup unless escaped
function escapeCommentary(text: string) {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

async function uploadImage(creds: ChannelCredentials, author: string, data: Buffer) {
  const init = await check(
    await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
      method: 'POST',
      headers: { ...restHeaders(creds), 'Content-Type': 'application/json' },
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    }),
    'image upload init',
  );
  const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } };
  await check(
    await fetch(value.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      body: new Uint8Array(data),
    }),
    'image upload',
  );
  return value.image;
}

export const linkedin: OAuthProvider = {
  id: 'linkedin',
  name: 'LinkedIn',
  connectType: 'oauth',
  maxLength: 3000,
  maxImages: 9,
  // Reading member post stats needs a partner-only scope (r_member_social)
  supportsMetrics: false,

  isConfigured: () => Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),

  authorizeUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<ConnectedAccount> {
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? '',
      }),
    });
    const tokens = await res.json();
    if (!res.ok) throw new Error(`LinkedIn token request failed: ${tokens.error_description ?? res.status}`);

    const me = await (
      await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
    ).json();

    return {
      externalId: me.sub,
      name: me.name,
      handle: me.name,
      avatarUrl: me.picture ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1000),
    };
  },

  async refresh(creds) {
    if (!creds.tokenExpiresAt || creds.tokenExpiresAt.getTime() > Date.now()) return null;
    // Standard LinkedIn apps get no refresh token: access lasts 60 days, then the user reconnects
    throw new ReconnectRequiredError('LinkedIn access expired');
  },

  async publish(creds, text, media) {
    const author = `urn:li:person:${creds.externalId}`;
    const imageUrns = [];
    for (const file of media) imageUrns.push(await uploadImage(creds, author, file.data));

    const content =
      imageUrns.length === 1
        ? { media: { id: imageUrns[0] } }
        : imageUrns.length > 1
          ? { multiImage: { images: imageUrns.map((id) => ({ id })) } }
          : undefined;

    const res = await check(
      await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: { ...restHeaders(creds), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author,
          commentary: escapeCommentary(text),
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
          ...(content ? { content } : {}),
        }),
      }),
      'post',
    );
    const urn = res.headers.get('x-restli-id') ?? '';
    return { externalId: urn, url: `https://www.linkedin.com/feed/update/${urn}` };
  },
};
