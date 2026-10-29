const STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SCHEDULED: 'bg-blue-50 text-blue-700',
  PUBLISHING: 'bg-amber-50 text-amber-700',
  PUBLISHED: 'bg-emerald-50 text-emerald-700',
  PARTIAL: 'bg-orange-50 text-orange-700',
  FAILED: 'bg-red-50 text-red-700',
  PENDING: 'bg-slate-100 text-slate-700',
  READY: 'bg-violet-50 text-violet-700',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? STYLES.DRAFT}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

export const STATUS_DOT: Record<string, string> = {
  DRAFT: 'bg-slate-400',
  SCHEDULED: 'bg-blue-500',
  PUBLISHING: 'bg-amber-500',
  PUBLISHED: 'bg-emerald-500',
  PARTIAL: 'bg-orange-500',
  FAILED: 'bg-red-500',
};
