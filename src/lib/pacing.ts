import { Prisma } from '@prisma/client';
import { db } from './db';

const DAY_MS = 24 * 60 * 60 * 1000;
const RESERVE_ATTEMPTS = 10;

export interface Pace {
  minMinutesBetween: number;
  maxPerDay: number;
}

/**
 * The earliest time at or after `earliest` that keeps `minMinutesBetween` after the channel's
 * latest slot and no more than `maxPerDay` slots in any 24 hours. `taken` are the channel's
 * other published or reserved times.
 */
export function nextSlot(earliest: Date, taken: Date[], pace: Pace): Date {
  const times = taken.map((t) => t.getTime()).sort((a, b) => a - b);
  const gap = pace.minMinutesBetween * 60 * 1000;
  let slot = Math.max(earliest.getTime(), times.length ? times[times.length - 1] + gap : 0);

  for (;;) {
    const inWindow = times.filter((t) => t > slot - DAY_MS && t <= slot);
    if (inWindow.length < pace.maxPerDay) return new Date(slot);
    // Wait until enough of the window's slots have aged out
    slot = inWindow[inWindow.length - pace.maxPerDay] + DAY_MS + 1;
  }
}

/**
 * Reserves a publish slot for one target and stores it as `publishAfter`. Serializable isolation
 * makes two workers dispatching posts for the same channel at once retry instead of sharing a slot.
 */
export async function reserveSlot(targetId: string, channelId: string, pace: Pace, earliest = new Date()) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const since = new Date(earliest.getTime() - DAY_MS);
          const others = await tx.postTarget.findMany({
            where: {
              channelId,
              id: { not: targetId },
              OR: [
                { status: 'PENDING', publishAfter: { not: null } },
                { status: 'PUBLISHED', OR: [{ publishAfter: { gte: since } }, { publishedAt: { gte: since } }] },
              ],
            },
            select: { publishAfter: true, publishedAt: true },
          });
          const taken = others.map((t) => (t.publishAfter ?? t.publishedAt)!);
          const slot = nextSlot(earliest, taken, pace);
          await tx.postTarget.update({ where: { id: targetId }, data: { publishAfter: slot } });
          return slot;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // P2034: serialization conflict with a concurrent reservation
      const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (!conflict || attempt >= RESERVE_ATTEMPTS) throw e;
      // Random backoff so colliding workers don't retry in lockstep
      await new Promise((r) => setTimeout(r, Math.random() * 50 * attempt));
    }
  }
}
