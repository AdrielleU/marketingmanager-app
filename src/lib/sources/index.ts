import { email } from './email';
import { googleAlerts } from './google-alerts';
import type { ListeningSource, SourceId } from './types';

// To add a listen-only source: implement ListeningSource in its own file and register it here.
export const sources: Record<SourceId, ListeningSource> = { email, 'google-alerts': googleAlerts };

export function isSourceId(id: string): id is SourceId {
  return id in sources;
}
