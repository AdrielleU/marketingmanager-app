'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      className={`rounded-lg px-2 py-1.5 text-sm ${
        active ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </Link>
  );
}
