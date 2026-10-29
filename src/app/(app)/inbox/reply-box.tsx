'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { queueReply } from '@/actions/inbox';

const REFRESH_MS = 4000;

export function ReplyBox({
  itemId,
  maxLength,
  draft,
  replyText,
  replyStatus,
  replyUrl,
  replyError,
}: {
  itemId: string;
  maxLength: number;
  /** Claude's suggestion: opens the box prefilled so sending is one click after a read-through */
  draft: string | null;
  replyText: string | null;
  replyStatus: string | null;
  replyUrl: string | null;
  replyError: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(replyStatus === 'FAILED' || Boolean(draft));
  const [text, setText] = useState(replyText ?? draft ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = replyStatus === 'PENDING' || replyStatus === 'SENDING';

  // The worker sends the reply within seconds; refresh until it reports back
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [sending, router]);

  if (replyStatus === 'SENT') {
    return (
      <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">
        <p className="mb-1 text-xs font-medium text-emerald-700">You replied</p>
        <p className="whitespace-pre-wrap break-words">{replyText}</p>
        {replyUrl && (
          <a href={replyUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-600 hover:underline">
            View reply
          </a>
        )}
      </div>
    );
  }

  if (sending) return <p className="mt-3 text-xs text-slate-500">Sending reply…</p>;

  if (!open) {
    return (
      <button type="button" className="btn-secondary mt-3 py-1 text-xs" onClick={() => setOpen(true)}>
        Reply
      </button>
    );
  }

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await queueReply({ itemId, text });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-3">
      {replyStatus === 'FAILED' && replyError && <p className="mb-2 text-xs text-red-600">Reply failed: {replyError}</p>}
      {draft && replyStatus !== 'FAILED' && <p className="mb-1 text-xs font-medium text-slate-600">Suggested reply (edit before sending)</p>}
      <textarea
        className="input min-h-20 resize-y"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply…"
        aria-label="Reply"
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn-primary py-1 text-xs" disabled={pending || !text.trim()} onClick={send}>
          {replyStatus === 'FAILED' ? 'Try again' : 'Send reply'}
        </button>
        <button type="button" className="btn-secondary py-1 text-xs" onClick={() => setOpen(false)}>Cancel</button>
        <span className={`ml-auto text-xs ${text.length > maxLength ? 'font-medium text-red-600' : 'text-slate-400'}`}>
          {text.length}/{maxLength}
        </span>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
