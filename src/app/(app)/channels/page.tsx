import { connectManual, connectWithCredentials, disconnectChannel } from '@/actions/channels';
import { ActionForm, SubmitButton } from '@/components/form';
import { ProviderIcon } from '@/components/provider-icon';
import { hasRole, requireOrg } from '@/lib/auth';
import { publicChannelSelect } from '@/lib/channels';
import { db } from '@/lib/db';
import { providers } from '@/lib/providers';

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { org, role } = await requireOrg();
  const { error } = await searchParams;
  const canManage = hasRole(role, 'ADMIN');

  const channels = await db.channel.findMany({
    where: { orgId: org.id },
    select: publicChannelSelect,
    orderBy: { createdAt: 'asc' },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="page-title">Channels</h1>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="card divide-y divide-slate-100">
        {channels.length === 0 && <p className="p-5 text-sm text-slate-500">No channels connected yet.</p>}
        {channels.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-4">
            {c.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.avatarUrl} alt="" className="h-9 w-9 rounded-full" />
            ) : (
              <ProviderIcon provider={c.provider} size={36} />
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ProviderIcon provider={c.provider} size={14} /> {c.name}
              </p>
              <p className="truncate text-xs text-slate-500">@{c.handle}</p>
            </div>
            {c.needsReconnect && <span className="text-xs font-medium text-red-600">Needs reconnecting</span>}
            {canManage && (
              <form action={disconnectChannel}>
                <input type="hidden" name="channelId" value={c.id} />
                <button className="btn-danger">Disconnect</button>
              </form>
            )}
          </div>
        ))}
      </section>

      {canManage && (
        <section>
          <h2 className="mb-3 font-medium">Connect a channel</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {Object.values(providers).map((p) => (
              <div key={p.id} className="card p-4">
                <p className="mb-3 flex items-center gap-2 font-medium">
                  <ProviderIcon provider={p.id} size={20} /> {p.name}
                </p>
                {p.connectType === 'oauth' ? (
                  p.isConfigured() ? (
                    <a href={`/api/oauth/${p.id}/start`} className="btn-primary w-full">Connect {p.name}</a>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Add {p.id.toUpperCase()}_CLIENT_ID and {p.id.toUpperCase()}_CLIENT_SECRET to .env to enable.
                    </p>
                  )
                ) : p.connectType === 'manual' ? (
                  <ActionForm action={connectManual} className="space-y-3" resetOnSuccess>
                    <input type="hidden" name="provider" value={p.id} />
                    <div>
                      <label className="label" htmlFor={`${p.id}-handle`}>{p.accountLabel}</label>
                      <input className="input" id={`${p.id}-handle`} name="handle" placeholder={p.accountPlaceholder} autoComplete="off" required />
                      <p className="mt-1 text-xs text-slate-500">
                        You post by hand: when a post is due it appears in Ready to post with the text and images ready.
                        Nothing connects to {p.name}.
                      </p>
                    </div>
                    <SubmitButton className="btn-primary w-full">Add {p.name}</SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={connectWithCredentials} className="space-y-3" resetOnSuccess>
                    <input type="hidden" name="provider" value={p.id} />
                    {p.credentialFields.map((f) => (
                      <div key={f.name}>
                        <label className="label" htmlFor={`${p.id}-${f.name}`}>{f.label}</label>
                        <input
                          className="input"
                          id={`${p.id}-${f.name}`}
                          name={f.name}
                          type={f.type}
                          placeholder={f.placeholder}
                          autoComplete="off"
                          required
                        />
                        {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
                      </div>
                    ))}
                    <SubmitButton className="btn-primary w-full">Connect {p.name}</SubmitButton>
                  </ActionForm>
                )}
                {!p.publish && (
                  <p className="mt-3 text-xs text-slate-400">
                    Inbox only: comments, keyword matches and replies. Posting to {p.name} isn&apos;t supported yet.
                  </p>
                )}
                {p.pace && (
                  <p className="mt-3 text-xs text-slate-400">
                    Posts are spaced at least {p.pace.minMinutesBetween} minutes apart, up to {p.pace.maxPerDay} a day
                    per account.
                  </p>
                )}
                {!p.supportsMetrics && p.connectType !== 'manual' && (
                  <p className="mt-3 text-xs text-slate-400">{p.name} doesn&apos;t report post analytics.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
