import type { InboxEntry } from '../../providers/types';
import { decodeEntities } from '../../text';

/** The parts of a notification email the parsers look at. */
export interface Mail {
  fromAddress: string;
  fromName: string;
  subject: string;
  text: string;
  html: string;
}

export interface ParsedNotification {
  provider: string;
  kind: InboxEntry['kind'];
  url: string | null;
  authorName: string;
  authorHandle: string;
  text: string;
  threadKey: string | null;
}

/**
 * Recognizes one platform's notification emails. These are best guesses from the platforms'
 * usual formats, written to degrade gracefully: if the link or author can't be found, the
 * email still shows up with its subject.
 */
interface NotificationParser {
  provider: string;
  matches(mail: Mail): boolean;
  link: RegExp;
  /** Rewrites the platform's own redirect links into direct ones before matching */
  normalize?(url: string): string;
  threadKey?(url: string): string | null;
  author(mail: Mail, url: string | null): string | null;
  kind(subject: string): InboxEntry['kind'];
}

// Footer and boilerplate lines that aren't part of the message someone wrote
const BOILERPLATE =
  /unsubscribe|notification|preferences|settings|privacy|terms|download the app|app store|google play|view (it )?on|reply (to|on)|this email|you received|inc\.|©|all rights|sent to|manage|turn off/i;

/** Every URL in the email, with click-tracking wrappers (which embed the real link encoded) unwrapped. */
function allUrls(mail: Mail) {
  const raw = decodeEntities(`${mail.html} ${mail.text}`);
  const found = new Set<string>();
  for (const candidate of [raw, safeDecode(raw), safeDecode(safeDecode(raw))]) {
    for (const [url] of candidate.matchAll(/https?:\/\/[^\s"'<>()]+/g)) found.add(url);
  }
  return [...found];
}

function safeDecode(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/%2F/gi, '/').replace(/%3A/gi, ':').replace(/%3F/gi, '?').replace(/%3D/gi, '=').replace(/%26/gi, '&');
  }
}

// Drop tracking parameters so links are clean and stable
function cleanUrl(url: string) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref|correlation|\$|share_id|context|emailtype|cid|sid|aref|medium|mid|n_m|rms|bcode|lloc|iris|notif_|hc_|igsh|ig_mid|ndid)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

function snippet(mail: Mail) {
  const lines = mail.text
    .replace(/https?:\/\/\S+/g, '')
    .split('\n')
    .map((l) => l.replace(/^[>\s]+/, '').trim())
    .filter((l) => l.length > 1 && !BOILERPLATE.test(l));
  return lines.join('\n').slice(0, 1000);
}

const prefixed = (platform: string, id: string | undefined) => (id ? `${platform}:${id}` : null);

const PARSERS: NotificationParser[] = [
  {
    provider: 'reddit',
    matches: (m) => /(^|[@.])(redditmail|reddit)\.com$/i.test(m.fromAddress),
    // Longest match first below, so a comment permalink beats the post link
    link: /https:\/\/(?:www\.|old\.)?reddit\.com\/r\/\w+\/comments\/\w+(?:\/[^\s"'<>?#]*)?/gi,
    threadKey: (url) => prefixed('reddit', url.match(/\/comments\/(\w+)/)?.[1]),
    author: (m) => (m.subject.match(/u\/([\w-]+)/) ?? m.text.match(/u\/([\w-]+)/))?.[1] ?? null,
    kind: (subject) => (/mention/i.test(subject) ? 'mention' : 'reply'),
  },
  {
    provider: 'youtube',
    matches: (m) => /(^|[@.])youtube\.com$/i.test(m.fromAddress),
    link: /https:\/\/(?:www\.)?youtube\.com\/(?:watch\?v=[\w-]+(?:&lc=[\w.-]+)?|shorts\/[\w-]+)/gi,
    threadKey: (url) => prefixed('youtube', url.match(/(?:v=|shorts\/)([\w-]+)/)?.[1]),
    author: (m) => m.subject.match(/^@?(.+?) (?:commented|replied|mentioned|responded)/i)?.[1] ?? null,
    kind: (subject) => (/mention/i.test(subject) ? 'mention' : 'reply'),
  },
  {
    provider: 'x',
    matches: (m) => /(^|[@.])(x|twitter)\.com$/i.test(m.fromAddress),
    link: /https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w+\/status\/\d+/gi,
    author: (_m, url) => url?.match(/\.com\/(\w+)\/status/)?.[1] ?? null,
    kind: (subject) => (/mention/i.test(subject) ? 'mention' : 'reply'),
  },
  {
    provider: 'facebook',
    matches: (m) => /(^|[@.])(facebookmail|facebook)\.com$/i.test(m.fromAddress),
    // Post, comment, photo and video permalinks; not settings, help or the notification redirect itself
    link: /https:\/\/(?:www\.|m\.)?facebook\.com\/(?:permalink\.php\?[^\s"'<>]+|story\.php\?[^\s"'<>]+|photo(?:\.php)?\/?\?[^\s"'<>]+|(?:groups\/)?[\w.-]+\/(?:posts|videos)\/[\w-]+[^\s"'<>]*|reel\/\d+[^\s"'<>]*)/gi,
    // Notification links look like facebook.com/nd/?permalink.php&story_fbid=…&aref=…
    normalize: (url) => url.replace(/facebook\.com\/nd?\/\?([\w./-]+)&/, 'facebook.com/$1?'),
    threadKey: (url) => prefixed('facebook', url.match(/(?:story_fbid=|\/posts\/|fbid=|\/videos\/|\/reel\/)([\w-]+)/)?.[1]),
    author: (m) => m.subject.match(/^(.+?) (?:commented|replied|mentioned|tagged|shared|responded)/i)?.[1] ?? null,
    kind: (subject) => (/mention|tagged/i.test(subject) ? 'mention' : 'reply'),
  },
  {
    provider: 'instagram',
    matches: (m) => /(^|[@.])instagram\.com$/i.test(m.fromAddress),
    link: /https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+\/?(?:c\/\d+\/?)?/gi,
    threadKey: (url) => prefixed('instagram', url.match(/\/(?:p|reel|tv)\/([\w-]+)/)?.[1]),
    author: (m) => m.subject.match(/^@?([\w.]+) (?:commented|replied|mentioned|tagged|responded)/i)?.[1] ?? null,
    kind: (subject) => (/mention|tagged/i.test(subject) ? 'mention' : 'reply'),
  },
  {
    // Mastodon servers send from notifications@<server> and link statuses as /@user/<id>
    provider: 'mastodon',
    matches: (m) => /^notifications@/i.test(m.fromAddress) && /\/@[\w.]+\/\d+/.test(m.html + m.text),
    link: /https:\/\/[\w.-]+\/@[\w.]+(?:@[\w.-]+)?\/\d+/gi,
    author: (_m, url) => url?.match(/\/@([\w.]+(?:@[\w.-]+)?)\/\d+/)?.[1] ?? null,
    kind: (subject) => (/repl/i.test(subject) ? 'reply' : 'mention'),
  },
];

/** Turns a notification email into an inbox entry; unrecognized emails come back as provider "email". */
export function parseNotification(mail: Mail): ParsedNotification {
  const parser = PARSERS.find((p) => p.matches(mail));
  const urls = allUrls(mail);

  if (!parser) {
    return {
      provider: 'email',
      kind: 'mention',
      url: urls.find((u) => !/unsubscribe|preferences|settings/i.test(u)) ?? null,
      authorName: mail.fromName || mail.fromAddress,
      authorHandle: mail.fromAddress,
      text: [mail.subject, snippet(mail)].filter(Boolean).join('\n\n'),
      threadKey: null,
    };
  }

  const links = urls.flatMap((u) => [...(parser.normalize?.(u) ?? u).matchAll(parser.link)].map((m) => m[0]));
  const url = links.length ? cleanUrl(links.sort((a, b) => b.length - a.length)[0]) : null;
  const author = parser.author(mail, url) ?? mail.fromName;
  const body = snippet(mail);
  return {
    provider: parser.provider,
    kind: parser.kind(mail.subject),
    url,
    authorName: author,
    authorHandle: author,
    // The subject says what happened ("u/x replied to your post in r/y"); the body has their words
    text: [mail.subject, body].filter(Boolean).join('\n\n'),
    threadKey: url && parser.threadKey ? parser.threadKey(url) : null,
  };
}
