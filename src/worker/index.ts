import PgBoss from 'pg-boss';
import { db } from '@/lib/db';
import {
  dispatchDuePosts,
  METRICS_QUEUE,
  PUBLISH_QUEUE,
  publishTarget,
  refreshMetrics,
  type PublishJob,
} from '@/lib/publishing';

const DISPATCH_INTERVAL_MS = 10_000;

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 4 });
  boss.on('error', (e) => console.error('[pg-boss]', e));
  await boss.start();

  await boss.createQueue(PUBLISH_QUEUE);
  await boss.createQueue(METRICS_QUEUE);

  await boss.work<PublishJob>(PUBLISH_QUEUE, { includeMetadata: true, batchSize: 1 }, async ([job]) => {
    const isLastAttempt = job.retryCount >= job.retryLimit;
    await publishTarget(job.data.targetId, isLastAttempt);
  });

  await boss.schedule(METRICS_QUEUE, '*/30 * * * *');
  await boss.work(METRICS_QUEUE, async () => refreshMetrics());

  let dispatching = false;
  const timer = setInterval(async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      await dispatchDuePosts(boss);
    } catch (e) {
      console.error('[dispatch]', e);
    } finally {
      dispatching = false;
    }
  }, DISPATCH_INTERVAL_MS);

  console.log('[worker] running: publishing due posts every 10s, metrics every 30 min');

  const shutdown = async () => {
    clearInterval(timer);
    await boss.stop({ graceful: true, timeout: 10_000 });
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
