import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { db } from './db';
import { randomToken, sha256 } from './crypto';
import { checkEligibility } from './eligibility';

const SESSION_COOKIE = 'mm_session';
const ORG_COOKIE = 'mm_org';
const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { id: sha256(token), userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } });
  store.delete(SESSION_COOKIE);
  store.delete(ORG_COOKIE);
}

// cache(): layouts and pages each ask for the user, so look it up (and run the ban check) once per request.
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: sha256(token) },
    select: { expiresAt: true, user: { select: { id: true, email: true, name: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (!(await checkEligibility(session.user.email, 'session')).ok) {
    // Banned while signed in: end all their sessions so the ban applies now (and is logged once).
    await db.session.deleteMany({ where: { userId: session.user.id } });
    return null;
  }
  return session.user;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function setCurrentOrg(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: 'lax', path: '/' });
}

/** The signed-in user plus the organization they're working in (cookie, else their first). */
export async function requireOrg(minRole: Role = 'MEMBER') {
  const user = await requireUser();
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    select: { role: true, org: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (memberships.length === 0) redirect('/onboarding');

  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const current = memberships.find((m) => m.org.id === wanted) ?? memberships[0];

  if (!hasRole(current.role, minRole)) throw new Error('You do not have permission to do that');

  return {
    user,
    org: current.org,
    role: current.role,
    orgs: memberships.map((m) => ({ ...m.org, role: m.role })),
  };
}

const RANK: Record<Role, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

export function hasRole(role: Role, minRole: Role) {
  return RANK[role] >= RANK[minRole];
}
