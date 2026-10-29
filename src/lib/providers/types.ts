export type ProviderId =
  | 'bluesky'
  | 'x'
  | 'linkedin'
  | 'mastodon'
  | 'reddit'
  | 'telegram'
  | 'discord'
  | 'youtube'
  | 'facebook'
  | 'instagram';

/** What a provider returns after a successful connect or token refresh. */
export interface ConnectedAccount {
  externalId: string;
  name: string;
  handle: string;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}

/** Decrypted credentials handed to a provider at publish/metrics time. */
export interface ChannelCredentials {
  externalId: string;
  handle: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}

export interface MediaFile {
  data: Buffer;
  mimeType: string;
}

export interface PublishResult {
  externalId: string;
  url: string;
}

export interface Metrics {
  likes: number;
  reposts: number;
  replies: number;
  impressions?: number | null;
}

export interface CredentialField {
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  help?: string;
  optional?: boolean;
}

/** Extra per-post input a channel needs beyond the shared text (e.g. a Reddit title). */
export interface PostField {
  name: string;
  label: string;
  placeholder?: string;
  maxLength: number;
  required?: boolean;
}

/** Values for a provider's postFields, keyed by field name. */
export type PostOptions = Record<string, string>;

interface BaseProvider {
  id: ProviderId;
  name: string;
  /** Max characters per post */
  maxLength: number;
  maxImages: number;
  /** Posts need at least this many images (Instagram has no text-only posts) */
  minImages?: number;
  /** Whether this provider can report per-post metrics */
  supportsMetrics: boolean;
  postFields?: PostField[];
  /** Spacing the worker enforces per connected account, to stay under platform spam/rate limits. */
  pace?: { minMinutesBetween: number; maxPerDay: number };
  /** Warn before posting text that matches what this channel type got within this many days. */
  duplicateWindowDays?: number;
  /** Absent for inbox-only channels (comments and replies, no posting), e.g. YouTube until video upload exists. */
  publish?(creds: ChannelCredentials, text: string, media: MediaFile[], options: PostOptions): Promise<PublishResult>;
  /** Only run keyword searches this often, for APIs with a small daily quota (default: every inbox sync). */
  searchEveryMinutes?: number;
  /** Returns metrics keyed by externalId. Missing ids mean the post was not found. */
  fetchMetrics?(creds: ChannelCredentials, externalIds: string[]): Promise<Record<string, Metrics>>;
  /** Returns fresh tokens when the access token is expired or close to it; null if not needed. */
  refresh?(creds: ChannelCredentials): Promise<Partial<ConnectedAccount> | null>;
  /** Replies to and @mentions of the connected account since `since` (the platform's notifications). */
  fetchInbox?(creds: ChannelCredentials, since: Date): Promise<InboxEntry[]>;
  /** Public posts matching a keyword since `since`, excluding the connected account's own posts. */
  searchPosts?(creds: ChannelCredentials, keyword: string, since: Date): Promise<InboxEntry[]>;
  /** Replies as the connected account to the post with this externalId (from an InboxEntry). */
  reply?(creds: ChannelCredentials, externalId: string, text: string): Promise<PublishResult>;
}

/** A reply, mention or search hit, as returned by fetchInbox/searchPosts. */
export interface InboxEntry {
  kind: 'reply' | 'mention' | 'keyword';
  externalId: string;
  url: string;
  authorName: string;
  authorHandle: string;
  text: string;
  postedAt: Date;
  /** For replies: externalId of the post being replied to, to link it to one of ours */
  inReplyTo?: string | null;
}

export interface OAuthProvider extends BaseProvider {
  connectType: 'oauth';
  isConfigured(): boolean;
  authorizeUrl(params: { state: string; redirectUri: string; codeChallenge: string }): string;
  exchangeCode(params: { code: string; redirectUri: string; codeVerifier: string }): Promise<ConnectedAccount>;
}

export interface CredentialsProvider extends BaseProvider {
  connectType: 'credentials';
  credentialFields: CredentialField[];
  connect(fields: Record<string, string>): Promise<ConnectedAccount>;
}

/**
 * A channel a person posts to by hand: the app schedules the post and, when it's due, puts it in
 * "Ready to post" with the text and images ready. No login, no API calls to the platform.
 */
export interface ManualProvider extends BaseProvider {
  connectType: 'manual';
  /** Asked for when adding the channel, e.g. the @handle or Page link */
  accountLabel: string;
  accountPlaceholder: string;
  /** Where "Copy & open" takes the person to create the post */
  openUrl(handle: string): string;
}

export type Provider = OAuthProvider | CredentialsProvider | ManualProvider;

export class ReconnectRequiredError extends Error {
  constructor(message = 'The account needs to be reconnected') {
    super(message);
    this.name = 'ReconnectRequiredError';
  }
}
