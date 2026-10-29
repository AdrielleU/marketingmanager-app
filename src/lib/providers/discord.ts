import type { CredentialsProvider } from './types';
import { ReconnectRequiredError } from './types';

// Only accept real Discord webhook URLs, since the server makes requests to whatever is stored here.
const WEBHOOK_URL = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

interface Webhook {
  id: string;
  name: string | null;
  channel_id: string;
  guild_id?: string;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  // 401/404: the webhook was deleted or its token regenerated
  if (res.status === 401 || res.status === 404) throw new ReconnectRequiredError('The Discord webhook no longer exists');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Discord ${res.status}: ${json.message ?? res.statusText}`);
  return json as T;
}

export const discord: CredentialsProvider = {
  id: 'discord',
  name: 'Discord',
  connectType: 'credentials',
  maxLength: 2000,
  maxImages: 10,
  supportsMetrics: false,
  credentialFields: [
    {
      name: 'webhookUrl',
      label: 'Webhook URL',
      type: 'password',
      placeholder: 'https://discord.com/api/webhooks/…',
      help: 'In Discord: Server Settings → Integrations → Webhooks → New Webhook, pick the channel, then Copy Webhook URL.',
    },
  ],

  async connect(fields) {
    const webhookUrl = fields.webhookUrl?.trim();
    if (!webhookUrl || !WEBHOOK_URL.test(webhookUrl)) throw new Error('Enter a Discord webhook URL');

    const hook = await request<Webhook>(webhookUrl);
    return {
      externalId: hook.id,
      name: hook.name ?? 'Discord webhook',
      handle: hook.name ?? hook.id,
      // The webhook URL embeds its secret token, so it's stored encrypted like any access token
      accessToken: webhookUrl,
    };
  },

  async publish(creds, text, media) {
    const url = `${creds.accessToken}?wait=true`;
    let init: RequestInit;
    if (media.length === 0) {
      init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) };
    } else {
      const form = new FormData();
      const files = media.map((m, i) => ({ id: i, filename: `image${i}.${EXTENSIONS[m.mimeType] ?? 'png'}` }));
      form.append('payload_json', JSON.stringify({ content: text, attachments: files }));
      media.forEach((m, i) => form.append(`files[${i}]`, new Blob([new Uint8Array(m.data)], { type: m.mimeType }), files[i].filename));
      init = { method: 'POST', body: form };
    }

    const message = await request<{ id: string; channel_id: string }>(url, init);
    // The message doesn't say which server it's in; the webhook does
    const hook = await request<Webhook>(creds.accessToken);
    return {
      externalId: message.id,
      url: `https://discord.com/channels/${hook.guild_id ?? '@me'}/${message.channel_id}/${message.id}`,
    };
  },
};
