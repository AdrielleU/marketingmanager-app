'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { deletePost, retryFailed, savePost, type SavePostInput } from '@/actions/posts';
import { LocalTime } from '@/components/local-time';
import { ProviderIcon } from '@/components/provider-icon';
import { StatusBadge } from '@/components/status-badge';
import type { PostField } from '@/lib/providers/types';

export interface ComposerChannel {
  id: string;
  provider: string;
  providerName: string;
  name: string;
  handle: string;
  needsReconnect: boolean;
  maxLength: number;
  maxImages: number;
  minImages: number;
  /** Posted by hand from "Ready to post" when due */
  manual: boolean;
  postFields: PostField[];
}

export interface ComposerPost {
  id: string;
  content: string;
  status: string;
  scheduledAt: string | null;
  targets: {
    channelId: string;
    status: string;
    externalUrl: string | null;
    error: string | null;
    options: Record<string, string>;
    publishAfter: string | null;
  }[];
  media: { id: string; url: string }[];
}

const EDITABLE = ['DRAFT', 'SCHEDULED', 'FAILED'];

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultTime(post: ComposerPost | null, initialDate: string | null) {
  if (post?.scheduledAt) return toLocalInput(new Date(post.scheduledAt));
  if (initialDate) return `${initialDate}T09:00`;
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d);
}

export function Composer({
  channels,
  post,
  initialDate,
}: {
  channels: ComposerChannel[];
  post: ComposerPost | null;
  initialDate: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [content, setContent] = useState(post?.content ?? '');
  const [selected, setSelected] = useState<string[]>(
    post ? post.targets.map((t) => t.channelId) : channels.filter((c) => !c.needsReconnect).map((c) => c.id),
  );
  const [media, setMedia] = useState(post?.media ?? []);
  const [options, setOptions] = useState<Record<string, Record<string, string>>>(
    Object.fromEntries((post?.targets ?? []).map((t) => [t.channelId, t.options])),
  );
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Local time zone only exists in the browser
  useEffect(() => setWhen(defaultTime(post, initialDate)), [post, initialDate]);

  const readOnly = post !== null && !EDITABLE.includes(post.status);
  const chosen = channels.filter((c) => selected.includes(c.id));
  const maxImages = chosen.length ? Math.min(...chosen.map((c) => c.maxImages)) : 4;

  function setOption(channelId: string, name: string, value: string) {
    setOptions((all) => ({ ...all, [channelId]: { ...all[channelId], [name]: value } }));
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append('file', file);
        const res = await fetch('/api/media', { method: 'POST', body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Upload failed');
        setMedia((m) => [...m, json]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function submit(intent: SavePostInput['intent'], ignoreWarnings = false) {
    setError(null);
    startTransition(async () => {
      const result = await savePost({
        ignoreWarnings,
        id: post?.id,
        content,
        channelIds: selected,
        mediaIds: media.map((m) => m.id),
        options,
        intent,
        scheduledAt: when ? new Date(when).toISOString() : null,
      });
      if (!result.ok && result.confirm) {
        if (confirm(`${result.error}\n\nPublish anyway?`)) submit(intent, true);
      } else if (!result.ok) setError(result.error);
      else router.push(intent === 'draft' ? '/posts?status=DRAFT' : '/calendar');
    });
  }

  if (channels.length === 0) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="page-title">Connect a channel first</h1>
        <p className="mt-2 text-sm text-slate-600">Posts are published to your connected social accounts.</p>
        <Link href="/channels" className="btn-primary mt-6">Go to channels</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_380px]">
      <div className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="page-title mr-auto">{post ? 'Edit post' : 'New post'}</h1>
          {post && <StatusBadge status={post.status} />}
        </div>

        <p className="label">Channels</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {channels.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={readOnly || c.needsReconnect}
                onClick={() => toggle(c.id)}
                title={c.needsReconnect ? 'Reconnect this channel on the Channels page' : c.handle}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                  on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'
                }`}
              >
                <ProviderIcon provider={c.provider} />
                {c.name}
                {c.needsReconnect && <span className="text-xs text-red-600">reconnect</span>}
              </button>
            );
          })}
        </div>

        <label className="label" htmlFor="content">Post</label>
        <textarea
          id="content"
          className="input min-h-48 resize-y"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={readOnly}
          placeholder="What do you want to share?"
        />
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {chosen.map((c) => (
            <span key={c.id} className={content.length > c.maxLength ? 'font-medium text-red-600' : 'text-slate-500'}>
              {c.providerName}: {content.length}/{c.maxLength}
            </span>
          ))}
        </div>

        <div className="mt-4">
          <p className="label">Images</p>
          <div className="flex flex-wrap gap-2">
            {media.map((m) => (
              <div key={m.id} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="" className="h-full w-full object-cover" />
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setMedia((all) => all.filter((x) => x.id !== m.id))}
                    className="absolute right-1 top-1 rounded bg-black/60 px-1 text-xs text-white"
                    aria-label="Remove image"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {!readOnly && media.length < maxImages && (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500">
                {uploading ? 'Uploading…' : '+ Add'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => upload(e.target.files)}
                />
              </label>
            )}
          </div>
        </div>

        {!readOnly && (
          <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-5">
            <div>
              <label className="label" htmlFor="when">Publish at</label>
              <input id="when" type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={pending} onClick={() => submit('schedule')}>Schedule</button>
            <button className="btn-secondary" disabled={pending} onClick={() => submit('now')}>Publish now</button>
            <button className="btn-secondary" disabled={pending} onClick={() => submit('draft')}>Save draft</button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {post && (
          <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
            {(post.status === 'FAILED' || post.status === 'PARTIAL') && (
              <form action={retryFailed}>
                <input type="hidden" name="postId" value={post.id} />
                <button className="btn-secondary">Retry failed channels</button>
              </form>
            )}
            {post.status !== 'PUBLISHING' && (
              <form
                action={deletePost}
                onSubmit={(e) => {
                  if (!confirm('Delete this post? Already-published posts stay on the platforms.')) e.preventDefault();
                }}
              >
                <input type="hidden" name="postId" value={post.id} />
                <button className="btn-danger">Delete</button>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <p className="text-sm font-medium text-slate-700">Preview</p>
        {chosen.length === 0 && <p className="text-sm text-slate-500">Pick a channel to see a preview.</p>}
        {chosen.map((c) => {
          const target = post?.targets.find((t) => t.channelId === c.id);
          return (
            <div key={c.id} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <ProviderIcon provider={c.provider} size={20} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-slate-500">@{c.handle}</p>
                </div>
                {target && post?.status !== 'DRAFT' && (
                  <span className="ml-auto"><StatusBadge status={target.status} /></span>
                )}
              </div>
              {c.postFields.map((f) => {
                const value = options[c.id]?.[f.name] ?? '';
                return readOnly ? (
                  value && <p key={f.name} className="mb-1 text-sm font-medium">{value}</p>
                ) : (
                  <div key={f.name} className="mb-2">
                    <label className="label" htmlFor={`${c.id}-${f.name}`}>
                      {f.label}
                      {f.required && <span className="text-red-600"> *</span>}
                    </label>
                    <input
                      id={`${c.id}-${f.name}`}
                      className="input"
                      value={value}
                      maxLength={f.maxLength}
                      placeholder={f.placeholder}
                      onChange={(e) => setOption(c.id, f.name, e.target.value)}
                    />
                  </div>
                );
              })}
              <p className="whitespace-pre-wrap break-words text-sm">{content.slice(0, c.maxLength) || '…'}</p>
              {content.length > c.maxLength && (
                <p className="mt-1 text-xs text-red-600">{content.length - c.maxLength} characters over the limit</p>
              )}
              {media.length < c.minImages && (
                <p className="mt-1 text-xs text-red-600">{c.providerName} posts need at least {c.minImages} image{c.minImages > 1 ? 's' : ''}</p>
              )}
              {c.manual && (!target || target.status === 'PENDING') && (
                <p className="mt-1 text-xs text-slate-500">You post this one by hand: when it&apos;s due it appears in Ready to post.</p>
              )}
              {target?.status === 'READY' && (
                <Link href="/ready" className="mt-1 block text-xs text-violet-700 underline">Due now: open Ready to post</Link>
              )}
              {media.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {media.slice(0, c.maxImages).map((m) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={m.id} src={m.url} alt="" className="aspect-square w-full rounded object-cover" />
                  ))}
                </div>
              )}
              {target?.externalUrl && (
                <a href={target.externalUrl} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-brand-600 underline">
                  View on {c.providerName}
                </a>
              )}
              {target?.status === 'PENDING' && post?.status === 'PUBLISHING' && target.publishAfter && (
                <p className="mt-2 text-xs text-amber-700">
                  Spaced out to avoid {c.providerName}&apos;s spam limits: publishes around{' '}
                  <LocalTime iso={target.publishAfter} />
                </p>
              )}
              {target?.error && <p className="mt-2 text-xs text-red-600">{target.error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
