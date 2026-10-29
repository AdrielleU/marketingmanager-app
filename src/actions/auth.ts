'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createSession, destroySession, hashPassword, verifyPassword } from '@/lib/auth';

export type FormState = { error?: string } | undefined;

function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/calendar';
}

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export async function register(_: FormState, form: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email, password } = parsed.data;

  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    return { error: 'An account with that email already exists' };
  }
  const user = await db.user.create({
    data: { name, email, passwordHash: await hashPassword(password) },
    select: { id: true },
  });
  await createSession(user.id);
  redirect(safeNext(form.get('next')));
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, passwordHash: true },
  });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: 'Wrong email or password' };
  }
  await createSession(user.id);
  redirect(safeNext(form.get('next')));
}

export async function logout() {
  await destroySession();
  redirect('/login');
}
