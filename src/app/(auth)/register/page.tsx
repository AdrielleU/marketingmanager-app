import Link from 'next/link';
import { register } from '@/actions/auth';
import { ActionForm, SubmitButton } from '@/components/form';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="page-title mb-4">Create your account</h1>
      <ActionForm action={register} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ''} />
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input className="input" id="name" name="name" autoComplete="name" required />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <SubmitButton className="btn-primary w-full">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link className="font-medium text-brand-600" href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
          Sign in
        </Link>
      </p>
    </>
  );
}
