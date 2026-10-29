import type { ManualProvider } from './types';

// Posted by hand (no Graph API): the app schedules and reminds, a person posts from the Page
export const facebook: ManualProvider = {
  id: 'facebook',
  name: 'Facebook',
  connectType: 'manual',
  maxLength: 63_206,
  maxImages: 10,
  supportsMetrics: false,
  accountLabel: 'Page link or username',
  accountPlaceholder: 'https://www.facebook.com/yourpage',
  openUrl: (handle) =>
    /^https:\/\/(www\.|m\.)?facebook\.com\//.test(handle) ? handle : `https://www.facebook.com/${encodeURIComponent(handle.replace(/^@/, ''))}`,
};
