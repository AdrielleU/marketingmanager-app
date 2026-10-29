import type { Channel } from '@prisma/client';
import { db } from './db';
import { decrypt, encrypt } from './crypto';
import { getProvider } from './providers';
import type { ChannelCredentials, ConnectedAccount, ProviderId } from './providers/types';

/** Fields that are safe to send to the browser (never tokens). */
export const publicChannelSelect = {
  id: true,
  provider: true,
  name: true,
  handle: true,
  avatarUrl: true,
  needsReconnect: true,
  createdAt: true,
} as const;

export async function saveConnectedAccount(orgId: string, provider: ProviderId, account: ConnectedAccount) {
  const secrets = {
    name: account.name,
    handle: account.handle,
    avatarUrl: account.avatarUrl ?? null,
    accessToken: encrypt(account.accessToken),
    refreshToken: account.refreshToken ? encrypt(account.refreshToken) : null,
    tokenExpiresAt: account.tokenExpiresAt ?? null,
    needsReconnect: false,
  };
  return db.channel.upsert({
    where: { orgId_provider_externalId: { orgId, provider, externalId: account.externalId } },
    create: { orgId, provider, externalId: account.externalId, ...secrets },
    update: secrets,
    select: { id: true },
  });
}

function toCredentials(channel: Channel): ChannelCredentials {
  return {
    externalId: channel.externalId,
    handle: channel.handle,
    accessToken: decrypt(channel.accessToken),
    refreshToken: channel.refreshToken ? decrypt(channel.refreshToken) : null,
    tokenExpiresAt: channel.tokenExpiresAt,
  };
}

/** Decrypted credentials, refreshed first if the provider says they're expiring. */
export async function getFreshCredentials(channel: Channel): Promise<ChannelCredentials> {
  const creds = toCredentials(channel);
  const provider = getProvider(channel.provider);
  const updated = await provider.refresh?.(creds);
  if (!updated) return creds;

  await db.channel.update({
    where: { id: channel.id },
    data: {
      ...(updated.accessToken ? { accessToken: encrypt(updated.accessToken) } : {}),
      ...(updated.refreshToken ? { refreshToken: encrypt(updated.refreshToken) } : {}),
      ...(updated.tokenExpiresAt ? { tokenExpiresAt: updated.tokenExpiresAt } : {}),
    },
    select: { id: true },
  });
  return {
    ...creds,
    accessToken: updated.accessToken ?? creds.accessToken,
    refreshToken: updated.refreshToken ?? creds.refreshToken,
    tokenExpiresAt: updated.tokenExpiresAt ?? creds.tokenExpiresAt,
  };
}

export async function markNeedsReconnect(channelId: string) {
  await db.channel.update({ where: { id: channelId }, data: { needsReconnect: true }, select: { id: true } });
}
