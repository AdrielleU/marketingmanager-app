import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { FeedEntry, ListeningSource } from '../types';
import { parseNotification } from './parsers';

const PORT = 993;
// Catch up gradually after a long gap rather than reading a whole folder in one sync
const MAX_PER_SYNC = 50;
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
// A bare hostname: the worker connects to it, so no IPs, ports or localhost
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

interface Cursor {
  uidValidity: string;
  lastUid: number;
}

function parseUrl(url: string) {
  const u = new URL(url);
  return { host: u.hostname, user: decodeURIComponent(u.username), folder: decodeURIComponent(u.pathname.slice(1)) };
}

function client(host: string, user: string, pass: string) {
  return new ImapFlow({
    host,
    port: PORT,
    secure: true,
    auth: { user, pass },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/** Opens the folder read-only (EXAMINE), so nothing in the mailbox is ever changed or marked read. */
async function withFolder<T>(host: string, user: string, pass: string, folder: string, fn: (c: ImapFlow) => Promise<T>) {
  const c = client(host, user, pass);
  try {
    await c.connect();
  } catch (e) {
    const auth = e instanceof Error && /auth|credentials|password|login/i.test(`${e.message} ${(e as { responseText?: string }).responseText ?? ''}`);
    throw new Error(
      auth
        ? 'The mail server rejected the login. For Gmail, use an app password (Google Account → Security → 2-Step Verification → App passwords), not your normal password.'
        : `Couldn't connect to ${host}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    try {
      await c.mailboxOpen(folder, { readOnly: true });
    } catch {
      throw new Error(`No folder named "${folder}". In Gmail, create a label with that name and a filter that applies it.`);
    }
    return await fn(c);
  } finally {
    await c.logout().catch(() => c.close());
  }
}

export const email: ListeningSource = {
  id: 'email',
  name: 'Notification emails',
  help: 'Reads one folder of a mailbox (read-only) and turns Reddit, Facebook, Instagram, YouTube, X and Mastodon notification emails into inbox items. In Gmail, create a label (e.g. "Marketing Manager") and a filter that applies it to mail from redditmail.com, facebookmail.com, mail.instagram.com, youtube.com, x.com and your Mastodon server. Gmail needs an app password.',
  fields: [
    { name: 'address', label: 'Email address', type: 'text', placeholder: 'marketing@yourcompany.com' },
    { name: 'password', label: 'App password', type: 'password', placeholder: 'xxxx xxxx xxxx xxxx' },
    { name: 'folder', label: 'Folder or Gmail label', type: 'text', placeholder: 'Marketing Manager' },
    { name: 'host', label: 'IMAP server', type: 'text', placeholder: 'imap.gmail.com', optional: true },
  ],

  async setup(fields) {
    const address = (fields.address ?? '').trim();
    const password = (fields.password ?? '').replace(/\s+/g, ''); // Gmail shows app passwords in groups of four
    const folder = (fields.folder ?? '').trim();
    const host = (fields.host ?? '').trim().toLowerCase() || 'imap.gmail.com';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new Error('Enter the mailbox email address');
    if (!password) throw new Error('Enter the app password');
    if (!folder) throw new Error('Enter the folder or Gmail label to read');
    if (!HOSTNAME.test(host)) throw new Error('Enter the IMAP server name, like imap.gmail.com');

    // Check the login and folder now, so mistakes show up in the form instead of in the logs
    await withFolder(host, address, password, folder, async () => undefined);
    return { url: `imaps://${encodeURIComponent(address)}@${host}:${PORT}/${encodeURIComponent(folder)}`, secret: password };
  },

  async fetchEntries(feed, since) {
    const { host, user, folder } = parseUrl(feed.url);
    const cursor = feed.state as Cursor | null;

    return withFolder(host, user, feed.secret ?? '', folder, async (c) => {
      const mailbox = c.mailbox;
      if (!mailbox) throw new Error('Folder could not be opened');
      const uidValidity = String(mailbox.uidValidity);

      // UIDs are only comparable while UIDVALIDITY is unchanged; otherwise start over from the date window
      let uids: number[];
      if (cursor && cursor.uidValidity === uidValidity) {
        const found = (await c.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true })) || [];
        uids = found.filter((uid) => uid > cursor.lastUid); // "n:*" returns the last message even when none are newer
      } else {
        uids = (await c.search({ since }, { uid: true })) || [];
      }
      uids = uids.sort((a, b) => a - b).slice(0, MAX_PER_SYNC);
      if (uids.length === 0) return { entries: [], state: { uidValidity, lastUid: cursor?.uidValidity === uidValidity ? cursor.lastUid : 0 } };

      const entries: FeedEntry[] = [];
      for await (const message of c.fetch(uids, { uid: true, source: true, size: true }, { uid: true })) {
        if (!message.source || (message.size ?? 0) > MAX_MESSAGE_BYTES) continue;
        const mail = await simpleParser(message.source);
        const from = mail.from?.value[0];
        const parsed = parseNotification({
          fromAddress: (from?.address ?? '').toLowerCase(),
          fromName: from?.name ?? '',
          subject: mail.subject ?? '',
          text: mail.text ?? '',
          html: typeof mail.html === 'string' ? mail.html : '',
        });
        const messageId = mail.messageId ?? `uid:${uidValidity}:${message.uid}`;
        // Gmail can open a message by its Message-ID, which beats having no link at all
        const fallback = host === 'imap.gmail.com' ? `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(messageId)}` : null;
        const url = parsed.url ?? fallback;
        if (!url) continue;
        entries.push({
          kind: parsed.kind,
          provider: parsed.provider,
          externalId: messageId,
          url,
          authorName: parsed.authorName,
          authorHandle: parsed.authorHandle,
          text: parsed.text,
          postedAt: mail.date ?? new Date(),
          threadKey: parsed.threadKey,
        });
      }
      return { entries, state: { uidValidity, lastUid: uids[uids.length - 1] } };
    });
  },
};
