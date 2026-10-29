'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const REFRESH_MS = 4000;

/** A suggested reply for a site we can't post to from here: tweak it, copy it, open the thread. */
export function DraftBox({ draft, openUrl }: { draft: string; openUrl: string }) {
  const [text, setText] = useState(draft);
  const [copied, setCopied] = useState(false);

  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard needs https or localhost; the text is still there to select by hand
    }
    window.open(openUrl, '_blank', 'noopener');
  }

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="mb-1 text-xs font-medium text-slate-600">Suggested reply</p>
      <textarea
        className="input min-h-20 resize-y bg-white text-sm"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCopied(false);
        }}
        aria-label="Suggested reply"
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn-primary py-1 text-xs" onClick={copyAndOpen}>
          Copy &amp; open thread
        </button>
        <button
          type="button"
          className="btn-secondary py-1 text-xs"
          onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined)}
        >
          Copy
        </button>
        {copied && <span className="text-xs text-emerald-700">Copied</span>}
      </div>
    </div>
  );
}

/** Refreshes the page while drafts are being written, so they appear without a reload. */
export function RefreshWhileOpen() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
