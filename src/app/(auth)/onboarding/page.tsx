import { createOrganization } from '@/actions/team';
import { ActionForm, SubmitButton } from '@/components/form';
import { requireUser } from '@/lib/auth';

export default async function OnboardingPage() {
  await requireUser();
  return (
    <>
      <h1 className="page-title">Create your workspace</h1>
      <p className="mb-4 mt-1 text-sm text-slate-600">A workspace holds your channels, posts and teammates.</p>
      <ActionForm action={createOrganization} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">Workspace name</label>
          <input className="input" id="name" name="name" placeholder="Acme Marketing" required />
        </div>
        <SubmitButton className="btn-primary w-full">Continue</SubmitButton>
      </ActionForm>
    </>
  );
}
