import Link from 'next/link';
import type { InboxKind, Prisma } from '@prisma/client';
import {
  addFeed,
  addWatch,
  markAllDone,
  removeFeed,
  removeWatch,
  requestDraft,
  saveReplyGuidelines,
  setItemStatus,
} from '@/actions/inbox';
import { ActionForm, SubmitButton } from '@/components/form';
import { LocalTime } from '@/components/local-time';
import { ProviderIcon } from '@/components/provider-icon';
import { hasRole, requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { draftsEnabled } from '@/lib/inbox';
import { providers } from '@/lib/providers';
import type { ProviderId } from '@/lib/providers/types';
import { sources } from '@/lib/sources';
import type { SourceId } from '@/lib/sources/types';
import { DraftBox, RefreshWhileOpen } from './draft-box';
import { ReplyBox } from './reply-box';

const KINDS: { value: InboxKind; label: string }[] = [
  { value: 'REPLY', label: 'Replies' },
  { value: 'MENTION', label: '@Mentions' },
  { value: 'KEYWORD', label: 'Keyword matches' },
];

const VIEWS = [
  { value: '', label: 'Inbox' },
  { value: 'unread', label: 'Unread' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Done' },
] as const;

const KIND_LABEL: Record<InboxKind, string> = { REPLY: 'Reply', MENTION: 'Mention', KEYWORD: 'Keyword' };

type Search = { source?: string; kind?: string; view?: string; watch?: string };

const itemSelect = {
  id: true,
  provider: true,
  kind: true,
  url: true,
  authorName: true,
  authorHandle: true,
  text: true,
  postedAt: true,
  status: true,
  threadKey: true,
  draft: true,
  draftStatus: true,
  draftError: true,
  replyText: true,
  replyStatus: true,
  replyUrl: true,
  replyError: true,
  channel: { select: { name: true } },
  feed: { select: { label: true } },
  watch: { select: { keyword: true } },
  target: { select: { postId: true } },
} satisfies Prisma.InboxItemSelect;

type Item = Prisma.InboxItemGetPayload<{ select: typeof itemSelect }>;

export default async function InboxPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { org, role } = await requireOrg();
  const params = await searchParams;
  const isAdmin = hasRole(role, 'ADMIN');
  const drafts = draftsEnabled();

  const [channels, watches, feeds, settings] = await Promise.all([
    db.channel.findMany({ where: { orgId: org.id }, select: { provider: true }, distinct: ['provider'] }),
    db.watch.findMany({ where: { orgId: org.id }, select: { id: true, keyword: true }, orderBy: { keyword: 'asc' } }),
    db.feed.findMany({
      where: { orgId: org.id },
      select: { id: true, label: true, sourceId: true, error: true },
      orderBy: { label: 'asc' },
    }),
    db.organization.findUnique({ where: { id: org.id }, select: { replyGuidelines: true } }),
  ]);

  const kind = KINDS.find((k) => k.value === params.kind)?.value;
  const view = VIEWS.find((v) => v.value === params.view)?.value ?? '';
  const where: Prisma.InboxItemWhereInput = {
    orgId: org.id,
    ...(params.source ? { provider: params.source } : {}),
    ...(kind ? { kind } : {}),
    ...(params.watch ? { watchId: params.watch } : {}),
    ...(view === 'unread'
      ? { status: 'UNREAD' }
      : view === 'replied'
        ? { replyStatus: 'SENT' }
        : view === 'archived'
          ? { status: 'ARCHIVED' }
          : { status: { not: 'ARCHIVED' } }),
  };

  const items = await db.inboxItem.findMany({ where, select: itemSelect, orderBy: { postedAt: 'desc' }, take: 100 });
  const providersSeen = await db.inboxItem.findMany({ where: { orgId: org.id }, select: { provider: true }, distinct: ['provider'] });

  // Filter options: connected channel types, feed types, and platforms that arrived by email
  const sourceIds = new Set([
    ...channels.map((c) => c.provider).filter((id) => providers[id as ProviderId]?.fetchInbox || providers[id as ProviderId]?.searchPosts),
    ...feeds.map((f) => f.sourceId),
    ...providersSeen.map((p) => p.provider),
  ]);
  const sourceOptions = [...sourceIds].map((id) => ({ value: id, label: sourceName(id) }));

  // Several notifications about one thread (a busy Reddit post) show as one card plus "N more"
  const groups: Item[][] = [];
  const byThread = new Map<string, Item[]>();
  for (const item of items) {
    const existing = item.threadKey ? byThread.get(item.threadKey) : undefined;
    if (existing) existing.push(item);
    else {
      const group = [item];
      groups.push(group);
      if (item.threadKey) byThread.set(item.threadKey, group);
    }
  }
  const pendingDrafts = items.some((i) => i.draftStatus === 'REQUESTED' || i.draftStatus === 'DRAFTING');

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_300px]">
      {pendingDrafts && <RefreshWhileOpen />}
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="page-title mr-auto">Inbox</h1>
          {VIEWS.map((v) => (
            <Link
              key={v.value}
              href={hrefWith(params, { view: v.value })}
              className={`rounded-lg px-3 py-1.5 text-sm ${view === v.value ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {v.label}
            </Link>
          ))}
        </div>

        {/* Plain GET form so filters live in the URL and work without JavaScript */}
        <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
          {view && <input type="hidden" name="view" value={view} />}
          <Filter name="source" label="Source" value={params.source} options={sourceOptions} />
          <Filter name="kind" label="Type" value={kind} options={KINDS} />
          <Filter name="watch" label="Keyword" value={params.watch} options={watches.map((w) => ({ value: w.id, label: w.keyword }))} />
          <button className="btn-secondary">Filter</button>
          {(params.source || kind || params.watch) && (
            <Link href={hrefWith({ view }, {})} className="text-sm text-slate-500 hover:underline">Clear</Link>
          )}
        </form>

        {items.length > 0 && view !== 'archived' && (
          // Its own form with the applied filters, so it archives exactly what the list shows
          <form action={markAllDone} className="mb-3 flex justify-end">
            <input type="hidden" name="source" value={params.source ?? ''} />
            <input type="hidden" name="kind" value={kind ?? ''} />
            <input type="hidden" name="watch" value={params.watch ?? ''} />
            <button className="text-xs text-slate-500 hover:text-slate-800">
              Mark all {params.source || kind || params.watch ? 'shown ' : ''}done
            </button>
          </form>
        )}

        <div className="space-y-3">
          {items.length === 0 && (
            <div className="card p-6 text-sm text-slate-500">
              {sourceOptions.length === 0
                ? 'Connect a channel, or add a notification email folder or Google Alerts feed on the right, to see replies and mentions here.'
                : 'Nothing here. New replies, mentions and keyword matches are checked every 5 minutes.'}
            </div>
          )}
          {groups.map(([first, ...rest]) => (
            <div key={first.id}>
              <ItemCard item={first} drafts={drafts} />
              {rest.length > 0 && (
                <details className="ml-6 mt-2">
                  <summary className="cursor-pointer text-xs text-slate-500">
                    {rest.length} more in this thread
                  </summary>
                  <div className="mt-2 space-y-2">
                    {rest.map((item) => (
                      <ItemCard key={item.id} item={item} drafts={drafts} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>

      <aside className="space-y-4">
        {drafts && (
          <section className="card p-4">
            <h2 className="mb-1 font-medium">Reply guidelines</h2>
            <p className="mb-3 text-xs text-slate-500">
              What Claude should know when drafting: what you sell, facts it may state, links, tone. Drafts never get
              posted on their own.
            </p>
            {isAdmin ? (
              <ActionForm action={saveReplyGuidelines} className="space-y-2">
                <textarea
                  name="guidelines"
                  className="input min-h-32 resize-y text-sm"
                  defaultValue={settings?.replyGuidelines ?? ''}
                  maxLength={5000}
                  placeholder="We make Acme, a scheduler for small teams. Free plan up to 3 channels. Friendly, plain language. Never promise features or dates."
                />
                <SubmitButton className="btn-secondary w-full">Save</SubmitButton>
              </ActionForm>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{settings?.replyGuidelines || 'None yet. Ask an admin to add some.'}</p>
            )}
          </section>
        )}

        <section className="card p-4">
          <h2 className="mb-1 font-medium">Keywords</h2>
          <p className="mb-3 text-xs text-slate-500">
            Public posts mentioning these show up as keyword matches. Searched through your connected{' '}
            {Object.values(providers)
              .filter((p) => p.searchPosts)
              .map((p) => (p.searchEveryMinutes ? `${p.name} (every ${p.searchEveryMinutes / 60} hours)` : p.name))
              .join(', ')}{' '}
            channels.
          </p>
          <ActionForm action={addWatch} className="flex gap-2" resetOnSuccess>
            <input name="keyword" className="input" placeholder="Brand or product name" required minLength={2} maxLength={100} />
            <SubmitButton className="btn-primary shrink-0">Add</SubmitButton>
          </ActionForm>
          <ul className="mt-3 space-y-1">
            {watches.map((w) => (
              <li key={w.id} className="flex items-center gap-2 text-sm">
                <Link href={hrefWith(params, { watch: w.id })} className="mr-auto truncate hover:underline">{w.keyword}</Link>
                <form action={removeWatch}>
                  <input type="hidden" name="watchId" value={w.id} />
                  <button className="text-xs text-slate-400 hover:text-red-600" aria-label={`Stop watching ${w.keyword}`}>Remove</button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        {Object.values(sources).map((source) => {
          const mine = feeds.filter((f) => f.sourceId === source.id);
          return (
            <section key={source.id} className="card p-4">
              <h2 className="mb-1 flex items-center gap-2 font-medium">
                <ProviderIcon provider={source.id} size={16} /> {source.name}
              </h2>
              <p className="mb-3 text-xs text-slate-500">{source.help}</p>
              <ul className="mb-3 space-y-2">
                {mine.map((f) => (
                  <li key={f.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="mr-auto truncate">{f.label}</span>
                      {isAdmin && (
                        <form action={removeFeed}>
                          <input type="hidden" name="feedId" value={f.id} />
                          <button className="text-xs text-slate-400 hover:text-red-600" aria-label={`Remove ${f.label}`}>Remove</button>
                        </form>
                      )}
                    </div>
                    {f.error && <p className="text-xs text-red-600">Last check failed: {f.error}</p>}
                  </li>
                ))}
              </ul>
              {isAdmin && (
                <ActionForm action={addFeed} className="space-y-2" resetOnSuccess>
                  <input type="hidden" name="sourceId" value={source.id} />
                  <input name="label" className="input" placeholder="Name, e.g. Brand mentions" required maxLength={100} aria-label="Name" />
                  {source.fields.map((f) => (
                    <input
                      key={f.name}
                      name={f.name}
                      type={f.type}
                      className="input"
                      placeholder={f.optional ? `${f.label} (default ${f.placeholder})` : f.placeholder ?? f.label}
                      aria-label={f.label}
                      required={!f.optional}
                      autoComplete="off"
                    />
                  ))}
                  <SubmitButton className="btn-primary w-full">Add</SubmitButton>
                </ActionForm>
              )}
            </section>
          );
        })}
      </aside>
    </div>
  );
}

function ItemCard({ item, drafts }: { item: Item; drafts: boolean }) {
  const provider = providers[item.provider as ProviderId];
  const canReplyHere = Boolean(item.channel && provider?.reply);
  const drafting = item.draftStatus === 'REQUESTED' || item.draftStatus === 'DRAFTING';
  const where = item.channel?.name ?? (item.feed ? `${sourceName(item.provider)} via ${item.feed.label}` : sourceName(item.provider));

  return (
    <article className={`card p-4 ${item.status === 'UNREAD' ? 'border-l-4 border-l-brand-500' : ''}`}>
      <header className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <ProviderIcon provider={item.provider} size={18} />
        <span className="font-medium">{item.authorName}</span>
        {item.authorHandle !== item.authorName && <span className="text-slate-500">@{item.authorHandle}</span>}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {KIND_LABEL[item.kind]}
          {item.watch && `: “${item.watch.keyword}”`}
        </span>
        <span className="ml-auto text-xs text-slate-500">
          <LocalTime iso={item.postedAt.toISOString()} />
        </span>
      </header>

      <p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>

      {drafts && item.replyStatus !== 'SENT' && (
        <div className="mt-3">
          {drafting && <p className="text-xs text-slate-500">Drafting a reply…</p>}
          {item.draftStatus === 'READY' && !item.draft && item.draftError && (
            <p className="text-xs text-amber-700">{item.draftError}</p>
          )}
          {item.draftStatus === 'READY' && item.draft && !canReplyHere && <DraftBox draft={item.draft} openUrl={item.url} />}
          {(item.draftStatus === 'FAILED' || item.draftStatus === null) && (
            <form action={requestDraft} className="flex items-center gap-2">
              <input type="hidden" name="itemId" value={item.id} />
              {item.draftStatus === 'FAILED' && <span className="text-xs text-red-600">Draft failed: {item.draftError}</span>}
              <button className="btn-secondary py-1 text-xs">{item.draftStatus === 'FAILED' ? 'Try again' : 'Draft reply'}</button>
            </form>
          )}
        </div>
      )}

      {canReplyHere && provider && (
        <ReplyBox
          key={item.draft ?? ''}
          itemId={item.id}
          maxLength={provider.maxLength}
          draft={item.draftStatus === 'READY' ? item.draft : null}
          replyText={item.replyText}
          replyStatus={item.replyStatus}
          replyUrl={item.replyUrl}
          replyError={item.replyError}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className={canReplyHere ? 'text-brand-600 hover:underline' : 'btn-primary py-1 text-xs'}
        >
          {canReplyHere ? `Open on ${provider?.name}` : `Open & reply on ${provider?.name ?? sourceSite(item)}`}
        </a>
        {item.target && <Link href={`/compose?id=${item.target.postId}`} className="text-slate-500 hover:underline">Your post</Link>}
        <span className="text-slate-400">via {where}</span>
        <div className="ml-auto flex items-center gap-3">
          {item.status !== 'ARCHIVED' && (
            <StatusButton itemId={item.id} status={item.status === 'UNREAD' ? 'READ' : 'UNREAD'} className="text-slate-500 hover:text-slate-800">
              Mark {item.status === 'UNREAD' ? 'read' : 'unread'}
            </StatusButton>
          )}
          <StatusButton
            itemId={item.id}
            status={item.status === 'ARCHIVED' ? 'READ' : 'ARCHIVED'}
            className={item.status === 'ARCHIVED' ? 'text-slate-500 hover:text-slate-800' : 'btn-secondary py-1 text-xs'}
          >
            {item.status === 'ARCHIVED' ? 'Undo done' : 'Done'}
          </StatusButton>
        </div>
      </div>
    </article>
  );
}

function sourceName(id: string) {
  return providers[id as ProviderId]?.name ?? sources[id as SourceId]?.name ?? (id === 'email' ? 'Email' : id);
}

function sourceSite(item: Item) {
  return item.provider === 'email' ? 'the site' : item.authorName;
}

function hrefWith(params: Search, changes: Search) {
  const merged = { ...params, ...changes };
  const query = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1])));
  return query.size ? `/inbox?${query}` : '/inbox';
}

function Filter({ name, label, value, options }: { name: string; label: string; value?: string; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="label" htmlFor={`filter-${name}`}>{label}</label>
      <select id={`filter-${name}`} name={name} defaultValue={value ?? ''} className="input py-1.5">
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function StatusButton({
  itemId,
  status,
  className,
  children,
}: {
  itemId: string;
  status: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <form action={setItemStatus}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="status" value={status} />
      <button className={className}>{children}</button>
    </form>
  );
}
