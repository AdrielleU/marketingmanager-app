import { bluesky } from './bluesky';
import { discord } from './discord';
import { facebook } from './facebook';
import { instagram } from './instagram';
import { linkedin } from './linkedin';
import { mastodon } from './mastodon';
import { reddit } from './reddit';
import { telegram } from './telegram';
import type { Provider, ProviderId } from './types';
import { x } from './x';
import { youtube } from './youtube';

// To add a channel: implement Provider in its own file and register it here.
export const providers: Record<ProviderId, Provider> = {
  bluesky,
  x,
  linkedin,
  mastodon,
  reddit,
  telegram,
  discord,
  youtube,
  facebook,
  instagram,
};

export function getProvider(id: string): Provider {
  const provider = providers[id as ProviderId];
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function isProviderId(id: string): id is ProviderId {
  return id in providers;
}

/** Whether posts can be scheduled to this channel type: published by the worker, or by hand (manual). */
export function canSchedule(provider: Provider) {
  return Boolean(provider.publish) || provider.connectType === 'manual';
}
