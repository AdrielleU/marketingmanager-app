'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireOrg } from '@/lib/auth';
import { saveConnectedAccount } from '@/lib/channels';
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
