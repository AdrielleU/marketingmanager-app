import { bluesky } from './bluesky';
import { linkedin } from './linkedin';
import type { Provider, ProviderId } from './types';
import { x } from './x';

// To add a channel: implement Provider in its own file and register it here.
export const providers: Record<ProviderId, Provider> = { bluesky, x, linkedin };

export function getProvider(id: string): Provider {
  const provider = providers[id as ProviderId];
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function isProviderId(id: string): id is ProviderId {
  return id in providers;
}
