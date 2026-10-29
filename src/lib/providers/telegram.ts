import type { CredentialsProvider, MediaFile } from './types';
import { ReconnectRequiredError } from './types';

const API = 'https://api.telegram.org';
// Telegram limits photo captions to 1024 characters; longer text goes in a follow-up message.
const CAPTION_LIMIT = 1024;

interface TelegramMessage {
  message_id: number;
  chat: { id: number; username?: string };
}

async function call<T>(botToken: string, method: string, body: Record<string, unknown> | FormData): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`${API}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) {
    // 401: token revoked; 403: bot was removed from the channel or lost posting rights
    if (res.status === 401 || res.status === 403) {
      throw new ReconnectRequiredError(`Telegram: ${json.description ?? 'the bot no longer has access'}`);
    }
    throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result as T;
}

function photoBlob(file: MediaFile) {
  return new Blob([new Uint8Array(file.data)], { type: file.mimeType });
}

function messageUrl(message: TelegramMessage) {
  if (message.chat.username) return `https://t.me/${message.chat.username}/${message.message_id}`;
  // Private channels: t.me/c/<id without the -100 prefix>/<message id>, only works for members
  return `https://t.me/c/${String(message.chat.id).replace(/^-100/, '')}/${message.message_id}`;
}

async function sendMedia(botToken: string, chatId: string, media: MediaFile[], caption?: string) {
  if (media.length === 1) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', photoBlob(media[0]), 'image');
    if (caption) form.append('caption', caption);
    return call<TelegramMessage>(botToken, 'sendPhoto', form);
  }

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append(
    'media',
    JSON.stringify(
      media.map((_, i) => ({ type: 'photo', media: `attach://file${i}`, ...(i === 0 && caption ? { caption } : {}) })),
    ),
  );
  media.forEach((file, i) => form.append(`file${i}`, photoBlob(file), `image${i}`));
  const messages = await call<TelegramMessage[]>(botToken, 'sendMediaGroup', form);
  return messages[0];
}

export const telegram: CredentialsProvider = {
  id: 'telegram',
  name: 'Telegram',
  connectType: 'credentials',
  maxLength: 4096,
  maxImages: 10,
  supportsMetrics: false,
  credentialFields: [
    {
      name: 'botToken',
      label: 'Bot token',
      type: 'password',
      placeholder: '123456:ABC-DEF…',
      help: 'Create a bot with @BotFather, then add it to your channel as an admin that can post messages.',
    },
    {
      name: 'chat',
      label: 'Channel',
      type: 'text',
      placeholder: '@yourchannel or -100…',
      help: 'The public @username, or the numeric id for a private channel.',
    },
  ],

  async connect(fields) {
    const botToken = fields.botToken?.trim();
    const chat = fields.chat?.trim();
    if (!botToken || !chat) throw new Error('Bot token and channel are required');

    const bot = await call<{ id: number }>(botToken, 'getMe', {});
    const info = await call<{ id: number; title?: string; username?: string; type: string }>(botToken, 'getChat', {
      chat_id: chat,
    });
    const member = await call<{ status: string; can_post_messages?: boolean }>(botToken, 'getChatMember', {
      chat_id: info.id,
      user_id: bot.id,
    });
    const canPost =
      member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false);
    if (!canPost) throw new Error('Make the bot an admin of the channel with permission to post messages');

    return {
      externalId: String(info.id),
      name: info.title ?? info.username ?? String(info.id),
      handle: info.username ?? String(info.id),
      accessToken: botToken,
    };
  },

  async publish(creds, text, media) {
    const chatId = creds.externalId;
    if (media.length === 0) {
      const message = await call<TelegramMessage>(creds.accessToken, 'sendMessage', { chat_id: chatId, text });
      return { externalId: String(message.message_id), url: messageUrl(message) };
    }

    const fitsCaption = text.length <= CAPTION_LIMIT;
    const first = await sendMedia(creds.accessToken, chatId, media, fitsCaption ? text : undefined);
    if (!fitsCaption) await call<TelegramMessage>(creds.accessToken, 'sendMessage', { chat_id: chatId, text });
    return { externalId: String(first.message_id), url: messageUrl(first) };
  },
};
