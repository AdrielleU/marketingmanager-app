'use client';

import { useEffect, useState } from 'react';

/** Renders a timestamp in the viewer's time zone (server render shows nothing to avoid a mismatch). */
export function LocalTime({ iso, options }: { iso: string; options?: Intl.DateTimeFormatOptions }) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText(
      new Date(iso).toLocaleString(undefined, options ?? { dateStyle: 'medium', timeStyle: 'short' }),
    );
  }, [iso, options]);
  return <time dateTime={iso}>{text}</time>;
}
