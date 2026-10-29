import { db } from './db';
import { getProvider } from './providers';

const DAY_MS = 24 * 60 * 60 * 1000;
// Below this many words, only an exact repeat counts; above it, near-copies (a changed link or emoji) count too
const MIN_WORDS_FOR_FUZZY = 8;
const SIMILARITY = 0.85;

function words(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

/** True when two texts are the same post for spam-filter purposes. */
export function isNearDuplicate(a: string, b: string) {
  const wa = words(a);
  const wb = words(b);
  if (wa.length < MIN_WORDS_FOR_FUZZY || wb.length < MIN_WORDS_FOR_FUZZY) return wa.join(' ') === wb.join(' ');
  const sa = new Set(wa);
  const sb = new Set(wb);
  const shared = [...sa].filter((w) => sb.has(w)).length;
  return shared / (sa.size + sb.size - shared) >= SIMILARITY;
}

/**
 * Warnings for channel types that flag repeated posts: the same text going to several accounts
 * of that type at once, or matching a post already sent or scheduled there recently.
 */
export async function duplicateWarnings(
  orgId: string,
  postId: string | undefined,
  content: string,
  channels: { provider: string }[],
): Promise<string[]> {
  const warnings: string[] = [];
  const providerIds = [...new Set(channels.map((c) => c.provider))];

  for (const providerId of providerIds) {
    const provider = getProvider(providerId);
    if (!provider.duplicateWindowDays) continue;

    const accounts = channels.filter((c) => c.provider === providerId).length;
    if (accounts > 1) {
      warnings.push(`Posting the same text to ${accounts} ${provider.name} accounts at once can be flagged as spam.`);
    }

    const since = new Date(Date.now() - provider.duplicateWindowDays * DAY_MS);
    const recent = await db.post.findMany({
      where: {
        orgId,
        ...(postId ? { id: { not: postId } } : {}),
        status: { in: ['SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL'] },
        targets: { some: { channel: { provider: providerId } } },
        OR: [{ scheduledAt: { gte: since } }, { createdAt: { gte: since } }],
      },
      select: { content: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (recent.some((p) => isNearDuplicate(p.content, content))) {
      warnings.push(
        `This matches a post already sent or scheduled to ${provider.name} in the last ${provider.duplicateWindowDays} days. Repeats there can be flagged as spam.`,
      );
    }
  }
  return warnings;
}
