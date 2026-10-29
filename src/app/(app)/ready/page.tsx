import Link from 'next/link';
import { markPosted, skipManualTarget } from '@/actions/posts';
import { ActionForm, SubmitButton } from '@/components/form';
import { LocalTime } from '@/components/local-time';
import { ProviderIcon } from '@/components/provider-icon';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { providers } from '@/lib/providers';
import type { ManualProvider, ProviderId } from '@/lib/providers/types';
import { CopyAndOpen } from './copy-and-open';

export default async function ReadyPage() {
  const { org } = await requireOrg();
  const targets = await db.postTarget.findMany({
    where: { status: 'READY', post: { orgId: org.id } },
    select: {
      id: true,
      readyAt: true,
      channel: { select: { provider: true, name: true, handle: true } },
      post: {
        select: {
          id: true,
          content: true,
          scheduledAt: true,
          media: { select: { media: { select: { id: true, fileName: true } } }, orderBy: { position: 'asc' } },
        },
      },
    },
    orderBy: { readyAt: 'asc' },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="page-title mb-1">Ready to post</h1>
      <p className="mb-4 text-sm text-slate-500">
        Posts for channels you post to by hand. Copy the text, post it on the platform as your brand, then mark it posted.
      </p>

      {targets.length === 0 && (
        <div className="card p-6 text-sm text-slate-500">
          Nothing to post right now. Posts scheduled to Facebook or Instagram show up here when they&apos;re due.
        </div>
      )}

      <div className="space-y-4">
        {targets.map((t) => {
          const provider = providers[t.channel.provider as ProviderId] as ManualProvider;
          const images = t.post.media.map(({ media }) => ({ id: media.id, url: `/media/${org.id}/${media.fileName}` }));
          return (
            <article key={t.id} className="card p-4">
              <header className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <ProviderIcon provider={t.channel.provider} size={20} />
                <span className="font-medium">{t.channel.name}</span>
                <span className="text-slate-500">{provider.name}</span>
                <span className="ml-auto text-xs text-slate-500">
                  Due <LocalTime iso={(t.post.scheduledAt ?? t.readyAt ?? new Date()).toISOString()} />
                </span>
              </header>

              <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm">{t.post.content}</p>

              {images.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {images.map((m, i) => (
                    <a key={m.id} href={m.url} download={`${i + 1}-${m.url.split('/').pop()}`} className="group relative block h-20 w-20 overflow-hidden rounded-lg border border-slate-200" title="Download">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt="" className="h-full w-full object-cover" />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-xs text-white">{i + 1}</span>
                    </a>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
                <CopyAndOpen
                  text={t.post.content}
                  openUrl={provider.openUrl(t.channel.handle)}
                  label={`Copy & open ${provider.name}`}
                  images={images.map((m, i) => ({ url: m.url, name: `${i + 1}-${m.url.split('/').pop()}` }))}
                />
                <ActionForm action={markPosted} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="targetId" value={t.id} />
                  <input name="url" className="input w-64 py-1.5 text-sm" placeholder="Link to the post (optional)" aria-label="Link to the post" />
                  <SubmitButton className="btn-primary">Posted</SubmitButton>
                </ActionForm>
                <form action={skipManualTarget} className="ml-auto">
                  <input type="hidden" name="targetId" value={t.id} />
                  <button className="text-xs text-slate-500 hover:text-red-600">Skip</button>
                </form>
              </div>
              <Link href={`/compose?id=${t.post.id}`} className="mt-2 inline-block text-xs text-slate-500 hover:underline">View post</Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}
