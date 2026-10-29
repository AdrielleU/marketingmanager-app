export type ProviderId = 'bluesky' | 'x' | 'linkedin';

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
}

interface BaseProvider {
  id: ProviderId;
  name: string;
  /** Max characters per post */
  maxLength: number;
  maxImages: number;
  /** Whether this provider can report per-post metrics */
  supportsMetrics: boolean;
  publish(creds: ChannelCredentials, text: string, media: MediaFile[]): Promise<PublishResult>;
  /** Returns metrics keyed by externalId. Missing ids mean the post was not found. */
  fetchMetrics?(creds: ChannelCredentials, externalIds: string[]): Promise<Record<string, Metrics>>;
  /** Returns fresh tokens when the access token is expired or close to it; null if not needed. */
  refresh?(creds: ChannelCredentials): Promise<Partial<ConnectedAccount> | null>;
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

export type Provider = OAuthProvider | CredentialsProvider;

export class ReconnectRequiredError extends Error {
  constructor(message = 'The account needs to be reconnected') {
    super(message);
    this.name = 'ReconnectRequiredError';
  }
}
