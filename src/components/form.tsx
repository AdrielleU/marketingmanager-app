'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/actions/auth';

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/** A form bound to a server action that returns { error }. Shows the error and a pending state. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await action(prev, form);
    if (resetOnSuccess && !result?.error) formRef.current?.reset();
    return result;
  }, undefined);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {children}
      {state?.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function SubmitButton({ children, className = 'btn-primary' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? 'Working…' : children}
    </button>
  );
}
