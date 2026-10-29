'use client';

import { useState } from 'react';

/** Copies the caption, downloads the images in order and opens the platform: the whole hand-off in one click. */
export function CopyAndOpen({
  text,
  openUrl,
  label,
  images,
}: {
  text: string;
  openUrl: string;
  label: string;
  images: { url: string; name: string }[];
}) {
  const [copied, setCopied] = useState<boolean | null>(null);

  async function run() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard needs https or localhost
    }
    for (const image of images) {
      const a = document.createElement('a');
      a.href = image.url;
      a.download = image.name;
      a.click();
    }
    window.open(openUrl, '_blank', 'noopener');
  }

  return (
    <div>
      <button type="button" className="btn-secondary" onClick={run}>
        {label}
        {images.length > 0 && ` + download ${images.length} image${images.length > 1 ? 's' : ''}`}
      </button>
      {copied === true && <p className="mt-1 text-xs text-emerald-700">Caption copied: paste it into the new post.</p>}
      {copied === false && <p className="mt-1 text-xs text-amber-700">Couldn&apos;t copy automatically; select the text above.</p>}
    </div>
  );
}
