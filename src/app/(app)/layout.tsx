import Link from 'next/link';
import { logout } from '@/actions/auth';
import { switchOrganization } from '@/actions/team';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { NavLink } from '@/components/nav-link';

const NAV = [
  { href: '/calendar', label: 'Calendar' },
  { href: '/posts', label: 'Posts' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/ready', label: 'Ready to post' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/channels', label: 'Channels' },
  { href: '/team', label: 'Team' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, org, orgs } = await requireOrg();
  const [unread, ready] = await Promise.all([
    db.inboxItem.count({ where: { orgId: org.id, status: 'UNREAD' } }),
    db.postTarget.count({ where: { status: 'READY', post: { orgId: org.id } } }),
  ]);
  const badges: Record<string, number> = { '/inbox': unread, '/ready': ready };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
        <Link href="/calendar" className="mb-6 px-2 text-base font-semibold text-brand-700">
          Marketing Manager
        </Link>

        {orgs.length > 1 ? (
          <form action={switchOrganization} className="mb-4">
            <select name="orgId" defaultValue={org.id} className="input" aria-label="Workspace">
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <button className="btn-secondary mt-2 w-full py-1 text-xs">Switch workspace</button>
          </form>
        ) : (
          <p className="mb-4 truncate px-2 text-sm text-slate-500">{org.name}</p>
        )}

        <Link href="/compose" className="btn-primary mb-4">New post</Link>

        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
              {(badges[item.href] ?? 0) > 0 && (
                <span className="ml-2 rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-medium text-white">
                  {badges[item.href] > 99 ? '99+' : badges[item.href]}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-slate-200 pt-4">
          <p className="truncate px-2 text-sm font-medium">{user.name}</p>
          <p className="truncate px-2 text-xs text-slate-500">{user.email}</p>
          <form action={logout}>
            <button className="btn-secondary mt-3 w-full py-1 text-xs">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
