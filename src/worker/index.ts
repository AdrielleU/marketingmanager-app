import PgBoss from 'pg-boss';
import { db } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  dispatchDuePosts,
  METRICS_QUEUE,
  PUBLISH_QUEUE,
  publishTarget,
  refreshMetrics,
  type PublishJob,
} from '@/lib/publishing';

const DISPATCH_INTERVAL_MS = 10_000;
const log = createLogger('worker');

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 4 });
  boss.on('error', (e) => log.error('pg-boss error', { error: e }));
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
      log.error('dispatch failed', { error: e });
    } finally {
      dispatching = false;
    }
  }, DISPATCH_INTERVAL_MS);

  log.info('running', { dispatchEverySeconds: DISPATCH_INTERVAL_MS / 1000, metricsCron: '*/30 * * * *' });

  const shutdown = async () => {
    log.info('shutting down');
    clearInterval(timer);
    await boss.stop({ graceful: true, timeout: 10_000 });
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  log.error('worker crashed', { error: e });
  process.exit(1);
});
