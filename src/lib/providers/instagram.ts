import type { ManualProvider } from './types';

// Posted by hand (no Instagram API): the app schedules and reminds, a person posts
export const instagram: ManualProvider = {
  id: 'instagram',
  name: 'Instagram',
  connectType: 'manual',
  maxLength: 2200,
  maxImages: 10,
  minImages: 1,
  supportsMetrics: false,
  accountLabel: 'Instagram handle',
  accountPlaceholder: '@yourbrand',
  // Signed in as the brand, "Create" in Instagram's sidebar is available from the profile page
  openUrl: (handle) => `https://www.instagram.com/${encodeURIComponent(handle.replace(/^@/, ''))}/`,
};
