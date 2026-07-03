/**
 * Nightly pipeline orchestrator.
 *
 * Invoked two ways, same code path:
 *   - production: the `nightlyPipeline` scheduled Cloud Function (see index.ts)
 *   - local dev:  `npx tsx src/pipeline/local.ts`
 *
 * For every user:
 *   1. sync each Plaid item (Plaid /transactions/sync)
 *   2. classify newly-synced, unclassified, unlocked transactions (Gemini)
 *   3. compute the current month's StatsSnapshot
 *   4. build guarded AI suggestions (Gemini, only when signals fire)
 *   5. write the daily insight and (optionally) push it
 *
 * Robustness:
 *   - Per-item sync failures are counted but do NOT abort the user; the user's
 *     run is recorded as 'partial'. A thrown later stage records 'error'.
 *   - One bad user never fails the whole run.
 */
import { paths, toDateKey, toMonthKey, type PlaidItem, type UserProfile } from '@expense/shared';
import { db, FieldValue } from '../admin';
import { syncItem } from './sync';
import { classifyNew } from './classify';
import { computeStats } from './stats';
import { buildSuggestions } from './suggest';
import { writeAndNotify } from './notify';

const DEFAULT_TZ = 'America/Los_Angeles';

/** Runs all per-user stages. Returns the number of Plaid items that failed to sync. */
async function processUser(uid: string, profile: UserProfile, now: Date): Promise<number> {
  const userTz = profile.settings?.tz || DEFAULT_TZ;
  const month = toMonthKey(now, userTz);
  const dateKey = toDateKey(now, userTz);

  console.log(`[user] ${uid}: start (tz=${userTz}, month=${month})`);

  // 1. Sync every Plaid item.
  let itemFailures = 0;
  const itemsSnap = await db.collection(paths.plaidItems(uid)).get();
  for (const itemDoc of itemsSnap.docs) {
    const item = itemDoc.data() as PlaidItem;
    try {
      const counts = await syncItem(uid, item, userTz);
      console.log(
        `[user] ${uid}: synced item ${item.itemId} — +${counts.added} ~${counts.modified} -${counts.removed}`,
      );
    } catch (err) {
      // Record the item-level error but keep going with other items/steps.
      itemFailures += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[user] ${uid}: item ${item.itemId} sync failed: ${message}`);
      await db
        .doc(paths.plaidItem(uid, item.itemId))
        .set({ status: 'error', error: message }, { merge: true })
        .catch(() => undefined);
    }
  }

  // 2. Classify newly-synced transactions.
  const classifyCounts = await classifyNew(uid, userTz);
  console.log(
    `[user] ${uid}: classified ${classifyCounts.classified} txns, ${classifyCounts.newCategories} new categories`,
  );

  // 3. Compute stats for the current month.
  const stats = await computeStats(uid, month, userTz, now);
  console.log(
    `[user] ${uid}: MTD spend ${stats.monthToDateSpend.toFixed(2)}, projected ${stats.projectedMonthEndSpend.toFixed(
      2,
    )}`,
  );

  // 4. Build guarded suggestions.
  const tips = await buildSuggestions(uid, stats);
  console.log(`[user] ${uid}: ${tips.length} tip(s)`);

  // 5. Persist insight + push.
  await writeAndNotify(uid, dateKey, tips, stats, profile);
  console.log(`[user] ${uid}: done (${itemFailures} item failure(s))`);

  return itemFailures;
}

async function updateSyncState(
  uid: string,
  status: 'ok' | 'partial' | 'error',
  error: string | null,
): Promise<void> {
  await db
    .doc(paths.syncState(uid))
    .set(
      {
        lastRunAt: FieldValue.serverTimestamp(),
        lastRunStatus: status,
        lastError: error,
        runCount: FieldValue.increment(1),
      },
      { merge: true },
    )
    .catch((err) => {
      console.error(`[user] ${uid}: failed to update syncState:`, err);
    });
}

/** Entry point (called by the scheduled function and the local runner). */
export async function runPipeline(): Promise<void> {
  const now = new Date();
  console.log(`[pipeline] start ${now.toISOString()}`);

  // Catastrophic if we can't even list users — let the caller surface it.
  const usersSnap = await db.collection('users').get();
  console.log(`[pipeline] ${usersSnap.size} user(s)`);

  let ok = 0;
  let partial = 0;
  let failed = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const profile = userDoc.data() as UserProfile;
    try {
      const itemFailures = await processUser(uid, profile, now);
      if (itemFailures > 0) {
        await updateSyncState(uid, 'partial', `${itemFailures} item(s) failed to sync`);
        partial += 1;
      } else {
        await updateSyncState(uid, 'ok', null);
        ok += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[user] ${uid}: FAILED: ${message}`);
      if (err instanceof Error && err.stack) console.error(err.stack);
      await updateSyncState(uid, 'error', message);
      failed += 1;
    }
  }

  console.log(`[pipeline] done: ${ok} ok, ${partial} partial, ${failed} failed`);
}
