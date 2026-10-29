import Link from 'next/link';
import { login } from '@/actions/auth';
import { ActionForm, SubmitButton } from '@/components/form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="page-title mb-4">Sign in</h1>
      <ActionForm action={login} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ''} />
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton className="btn-primary w-full">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-slate-600">
        No account?{' '}
        <Link className="font-medium text-brand-600" href={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
          Create one
        </Link>
      </p>
    </>
  );
}
