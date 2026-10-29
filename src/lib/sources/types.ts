import type { CredentialField, InboxEntry } from '../providers/types';

export type SourceId = 'google-alerts' | 'email';

/** What's stored for one feed; `secret` is decrypted before it's handed to the source. */
export interface FeedConfig {
  url: string;
  secret: string | null;
  state: unknown;
}

/** An inbox entry from a feed, which may say which platform it's about (a Reddit notification email). */
export interface FeedEntry extends InboxEntry {
  provider?: string;
  threadKey?: string | null;
}

/**
 * A listen-only feed for the inbox: no publishing, and replies happen on the site itself.
 * Each org adds feeds (a Google Alerts RSS link, a mailbox folder) and the worker polls them.
 */
export interface ListeningSource {
  id: SourceId;
  name: string;
  /** Shown above the form */
  help: string;
  fields: CredentialField[];
  /** Validates the form (and may check access) and returns what to store. Throws with a user-facing message. */
  setup(fields: Record<string, string>): Promise<{ url: string; secret?: string }>;
  /** New entries since `since` (or since the stored cursor), plus the cursor to store for next time. */
  fetchEntries(feed: FeedConfig, since: Date): Promise<{ entries: FeedEntry[]; state?: unknown }>;
}
