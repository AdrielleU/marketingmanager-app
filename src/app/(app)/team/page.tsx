import { changeRole, createInvite, leaveOrganization, removeMember, revokeInvite } from '@/actions/team';
import { ActionForm, SubmitButton } from '@/components/form';
import { LocalTime } from '@/components/local-time';
import { hasRole, requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function TeamPage() {
  const { org, user, role } = await requireOrg();
  const isAdmin = hasRole(role, 'ADMIN');
  const isOwner = role === 'OWNER';

  const [members, invites] = await Promise.all([
    db.membership.findMany({
      where: { orgId: org.id },
      select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    isAdmin
      ? db.invite.findMany({
          where: { orgId: org.id, acceptedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, email: true, role: true, token: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : [],
  ]);

  const appUrl = process.env.APP_URL ?? '';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="page-title">Team</h1>

      <section className="card divide-y divide-slate-100">
        {members.map((m) => (
          <div key={m.user.id} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {m.user.name} {m.user.id === user.id && <span className="text-slate-400">(you)</span>}
              </p>
              <p className="truncate text-xs text-slate-500">{m.user.email}</p>
            </div>
            {isOwner && m.user.id !== user.id ? (
              <form action={changeRole} className="flex items-center gap-2">
                <input type="hidden" name="userId" value={m.user.id} />
                <select name="role" defaultValue={m.role} className="input py-1">
                  <option value="OWNER">Owner</option>
                  <option value="ADMIN">Admin</option>
                  <option value="MEMBER">Member</option>
                </select>
                <button className="btn-secondary py-1">Save</button>
              </form>
            ) : (
              <span className="text-xs text-slate-500">{m.role.toLowerCase()}</span>
            )}
            {isAdmin && m.user.id !== user.id && (isOwner || m.role !== 'OWNER') && (
              <form action={removeMember}>
                <input type="hidden" name="userId" value={m.user.id} />
                <button className="btn-danger py-1">Remove</button>
              </form>
            )}
          </div>
        ))}
      </section>

      {isAdmin && (
        <section className="card p-5">
          <h2 className="mb-3 font-medium">Invite a teammate</h2>
          <ActionForm action={createInvite} className="flex flex-wrap items-end gap-3" resetOnSuccess>
            <div className="min-w-60 flex-1">
              <label className="label" htmlFor="email">Email</label>
              <input className="input" id="email" name="email" type="email" required />
            </div>
            <div>
              <label className="label" htmlFor="role">Role</label>
              <select className="input" id="role" name="role" defaultValue="MEMBER">
                <option value="MEMBER">Member: create and schedule posts</option>
                <option value="ADMIN">Admin: also manage channels and team</option>
              </select>
            </div>
            <SubmitButton>Create invite link</SubmitButton>
          </ActionForm>

          {invites.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium text-slate-700">Pending invites</p>
              <p className="text-xs text-slate-500">Email sending isn&apos;t set up yet, so copy each link to the invitee.</p>
              {invites.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm">
                  <span className="font-medium">{inv.email}</span>
                  <span className="text-xs text-slate-500">
                    {inv.role.toLowerCase()} · expires <LocalTime iso={inv.expiresAt.toISOString()} options={{ dateStyle: 'medium' }} />
                  </span>
                  <input
                    readOnly
                    className="input flex-1 py-1 font-mono text-xs"
                    value={`${appUrl}/invite/${inv.token}`}
                    aria-label={`Invite link for ${inv.email}`}
                  />
                  <form action={revokeInvite}>
                    <input type="hidden" name="inviteId" value={inv.id} />
                    <button className="btn-danger py-1">Revoke</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <form action={leaveOrganization}>
        <button className="btn-danger">Leave {org.name}</button>
      </form>
    </div>
  );
}
