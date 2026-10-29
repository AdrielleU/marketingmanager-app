'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireOrg, requireUser, setCurrentOrg } from '@/lib/auth';
import { randomToken } from '@/lib/crypto';
import type { FormState } from './auth';

const INVITE_DAYS = 7;

export async function createOrganization(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };

  const org = await db.organization.create({
    data: { name, memberships: { create: { userId: user.id, role: 'OWNER' } } },
    select: { id: true },
  });
  await setCurrentOrg(org.id);
  redirect('/calendar');
}

export async function switchOrganization(form: FormData) {
  const user = await requireUser();
  const orgId = String(form.get('orgId') ?? '');
  const member = await db.membership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
    select: { orgId: true },
  });
  if (member) await setCurrentOrg(orgId);
  redirect('/calendar');
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  role: z.enum(['ADMIN', 'MEMBER']),
});

export async function createInvite(_: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrg('ADMIN');
  const parsed = inviteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const existing = await db.membership.findFirst({
    where: { orgId: org.id, user: { email: parsed.data.email } },
    select: { userId: true },
  });
  if (existing) return { error: 'That person is already a member' };

  await db.invite.create({
    data: {
      orgId: org.id,
      email: parsed.data.email,
      role: parsed.data.role,
      token: randomToken(),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  revalidatePath('/team');
}

export async function revokeInvite(form: FormData) {
  const { org } = await requireOrg('ADMIN');
  await db.invite.deleteMany({ where: { id: String(form.get('inviteId')), orgId: org.id, acceptedAt: null } });
  revalidatePath('/team');
}

export async function changeRole(form: FormData) {
  const { org, user } = await requireOrg('OWNER');
  const userId = String(form.get('userId'));
  const role = z.enum(['OWNER', 'ADMIN', 'MEMBER']).parse(form.get('role'));
  if (userId === user.id) throw new Error('You cannot change your own role');
  await db.membership.update({ where: { userId_orgId: { userId, orgId: org.id } }, data: { role } });
  revalidatePath('/team');
}

export async function removeMember(form: FormData) {
  const { org, user, role } = await requireOrg('ADMIN');
  const userId = String(form.get('userId'));
  const target = await db.membership.findUnique({
    where: { userId_orgId: { userId, orgId: org.id } },
    select: { role: true },
  });
  if (!target) return;
  if (userId === user.id) throw new Error('Use "Leave organization" to remove yourself');
  if (target.role === 'OWNER' && role !== 'OWNER') throw new Error('Only an owner can remove an owner');
  await db.membership.delete({ where: { userId_orgId: { userId, orgId: org.id } } });
  revalidatePath('/team');
}

export async function leaveOrganization() {
  const { org, user, role } = await requireOrg();
  if (role === 'OWNER') {
    const owners = await db.membership.count({ where: { orgId: org.id, role: 'OWNER' } });
    if (owners <= 1) throw new Error('Make someone else an owner before leaving');
  }
  await db.membership.delete({ where: { userId_orgId: { userId: user.id, orgId: org.id } } });
  redirect('/calendar');
}

export async function acceptInvite(form: FormData) {
  const user = await requireUser();
  const token = String(form.get('token'));
  const invite = await db.invite.findUnique({ where: { token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new Error('This invite is no longer valid');
  if (invite.email !== user.email.toLowerCase()) throw new Error(`This invite was sent to ${invite.email}`);

  await db.$transaction([
    db.membership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: invite.orgId } },
      create: { userId: user.id, orgId: invite.orgId, role: invite.role },
      update: {},
    }),
    db.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);
  await setCurrentOrg(invite.orgId);
  redirect('/calendar');
}
