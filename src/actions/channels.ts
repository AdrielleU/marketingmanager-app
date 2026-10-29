'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireOrg } from '@/lib/auth';
import { saveConnectedAccount } from '@/lib/channels';
import { encrypt } from '@/lib/crypto';
import { getProvider, isProviderId } from '@/lib/providers';
import type { FormState } from './auth';

export async function connectWithCredentials(_: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrg('ADMIN');
  const providerId = String(form.get('provider'));
  if (!isProviderId(providerId)) return { error: 'Unknown channel type' };

  const provider = getProvider(providerId);
  if (provider.connectType !== 'credentials') return { error: 'This channel connects with OAuth' };

  const fields: Record<string, string> = {};
  for (const field of provider.credentialFields) fields[field.name] = String(form.get(field.name) ?? '');

  try {
    const account = await provider.connect(fields);
    await saveConnectedAccount(org.id, providerId, account);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not connect' };
  }
  revalidatePath('/channels');
  return {};
}

export async function disconnectChannel(form: FormData) {
  const { org } = await requireOrg('ADMIN');
  await db.channel.deleteMany({ where: { id: String(form.get('channelId')), orgId: org.id } });
  revalidatePath('/channels');
}

/** Adds a channel that's posted to by hand: just a name to show and where "Copy & open" goes. */
export async function connectManual(_: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrg('ADMIN');
  const providerId = String(form.get('provider'));
  if (!isProviderId(providerId)) return { error: 'Unknown channel type' };
  const provider = getProvider(providerId);
  if (provider.connectType !== 'manual') return { error: 'This channel connects differently' };

  const handle = String(form.get('handle') ?? '').trim().replace(/\/+$/, '').slice(0, 200);
  if (!handle) return { error: `Enter the ${provider.accountLabel.toLowerCase()}` };
  const name = handle.replace(/^https?:\/\/(www\.|m\.)?[^/]+\//, '').replace(/^@/, '') || handle;

  const exists = await db.channel.findFirst({ where: { orgId: org.id, provider: providerId, externalId: handle }, select: { id: true } });
  if (exists) return { error: `That ${provider.name} account is already added` };
  await db.channel.create({
    // No token: the platform is never contacted. The column is required, so store an encrypted placeholder.
    data: { orgId: org.id, provider: providerId, externalId: handle, name, handle, accessToken: encrypt('manual') },
    select: { id: true },
  });
  revalidatePath('/channels');
  return {};
}
