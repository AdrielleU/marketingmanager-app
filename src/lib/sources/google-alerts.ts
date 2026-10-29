import { decodeEntities, htmlToText } from '../text';
import type { ListeningSource } from './types';

// Only Google's own feed URLs: the worker fetches whatever is stored here
const FEED_URL = /^https:\/\/www\.google\.com\/alerts\/feeds\/\d+\/\d+$/;

function tag(xml: string, name: string) {
  return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
}

// Feed fields are HTML that has been entity-encoded once more for XML
function feedText(raw: string) {
  return htmlToText(decodeEntities(raw));
}

// Links go through a google.com/url redirect; show and open the real page
function unwrap(link: string) {
  try {
    return new URL(link).searchParams.get('url') ?? link;
  } catch {
    return link;
  }
}

export const googleAlerts: ListeningSource = {
  id: 'google-alerts',
  name: 'Google Alerts',
  help: 'At google.com/alerts, create an alert, open "Show options", set "Deliver to" to RSS feed, then copy the feed link. Matches from news, blogs, forums and Reddit threads Google has indexed arrive as keyword matches, usually hours after they\'re posted.',
  fields: [{ name: 'url', label: 'Feed link', type: 'text', placeholder: 'https://www.google.com/alerts/feeds/…' }],

  async setup(fields) {
    const url = (fields.url ?? '').trim();
    if (!FEED_URL.test(url)) throw new Error("That isn't a Google Alerts feed link");
    return { url };
  },

  async fetchEntries(feed, since) {
    const res = await fetch(feed.url);
    if (!res.ok) throw new Error(`Google Alerts feed returned ${res.status}`);
    const xml = await res.text();

    const entries = [];
    for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const postedAt = new Date(tag(entry, 'published') || tag(entry, 'updated'));
      if (Number.isNaN(postedAt.getTime()) || postedAt < since) continue;
      const url = unwrap(decodeEntities(entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? ''));
      const site = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, '');
        } catch {
          return 'web';
        }
      })();
      const title = feedText(tag(entry, 'title'));
      const snippet = feedText(tag(entry, 'content'));
      entries.push({
        kind: 'keyword' as const,
        externalId: tag(entry, 'id'),
        url,
        authorName: site,
        authorHandle: site,
        text: snippet ? `${title}\n\n${snippet}` : title,
        postedAt,
      });
    }
    return { entries: entries.filter((e) => e.externalId && e.url) };
  },
};
