import Link from 'next/link';
import { acceptInvite } from '@/actions/team';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await db.invite.findUnique({
    where: { token },
    select: { email: true, role: true, expiresAt: true, acceptedAt: true, org: { select: { name: true } } },
  });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return <p className="text-sm text-slate-700">This invite link is invalid or has expired.</p>;
  }

  const user = await getCurrentUser();
  const next = `/invite/${token}`;
  return (
    <>
      <h1 className="page-title">Join {invite.org.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        You were invited as {invite.role.toLowerCase()} ({invite.email}).
      </p>
      {user ? (
        <form action={acceptInvite} className="mt-4">
          <input type="hidden" name="token" value={token} />
          <button className="btn-primary w-full">Accept invite</button>
          {user.email !== invite.email && (
            <p className="mt-3 text-sm text-amber-700">
              You are signed in as {user.email}. Sign in as {invite.email} to accept.
            </p>
          )}
        </form>
      ) : (
        <div className="mt-4 flex gap-2">
          <Link className="btn-primary flex-1" href={`/register?next=${encodeURIComponent(next)}`}>
            Create account
          </Link>
          <Link className="btn-secondary flex-1" href={`/login?next=${encodeURIComponent(next)}`}>
            Sign in
          </Link>
        </div>
      )}
    </>
  );
}
