/**
 * Plaid `/transactions/sync` for one item.
 *
 * Cursor semantics (important):
 *  - We page from `item.cursor` (persisted in Firestore) until has_more=false,
 *    accumulating added/modified/removed across ALL pages.
 *  - If Plaid returns TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION mid-loop, the
 *    dataset changed under us; per Plaid guidance we discard partial results and
 *    RESTART from the ORIGINAL page-1 cursor (item.cursor at entry), up to
 *    PIPELINE.maxSyncRestarts times.
 *  - We only commit writes AFTER the whole loop succeeds, then persist
 *    next_cursor. This keeps the cursor and the data consistent: a crash before
 *    commit just replays the same window next run (sync is idempotent by doc id).
 *
 * pending -> posted transitions arrive as a `removed` (the pending txn id) plus
 * an `added`/`modified` (the posted txn id). Because doc id === transaction_id,
 * we delete the pending doc and upsert the posted one; both are handled by the
 * added/modified upsert + removed delete passes below.
 */
import {
  PIPELINE,
  paths,
  parsePlaidDate,
  plaidSyncResponseSchema,
  toMonthKey,
  type PlaidItem,
  type PlaidTransaction,
} from '@expense/shared';
import { db, FieldValue, Timestamp } from '../admin';
import { getPlaidClient } from '../plaidClient';

export interface SyncCounts {
  added: number;
  modified: number;
  removed: number;
}

/** Max Firestore ops per batched write (hard limit is 500; stay well under). */
const MAX_BATCH_OPS = 400;

interface AccumulatedPages {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removedIds: string[];
  nextCursor: string;
}

/** Extract a Plaid error_code from a thrown Axios-style error, if present. */
function plaidErrorCode(err: unknown): string | null {
  const data = (err as { response?: { data?: { error_code?: unknown } } })?.response?.data;
  const code = data?.error_code;
  return typeof code === 'string' ? code : null;
}

/**
 * Run the full pagination loop once, starting at `startCursor`. Throws on any
 * Plaid error (the caller inspects the code to decide whether to restart).
 */
async function paginate(
  accessToken: string,
  startCursor: string | null,
): Promise<AccumulatedPages> {
  const plaid = getPlaidClient();
  const added: PlaidTransaction[] = [];
  const modified: PlaidTransaction[] = [];
  const removedIds: string[] = [];

  let cursor: string | null = startCursor;
  let nextCursor = startCursor ?? '';
  let hasMore = true;

  while (hasMore) {
    const resp = await plaid.transactionsSync({
      access_token: accessToken,
      // Plaid treats an omitted/undefined cursor as "from the beginning".
      ...(cursor ? { cursor } : {}),
    });
    const page = plaidSyncResponseSchema.parse(resp.data);

    added.push(...page.added);
    modified.push(...page.modified);
    for (const r of page.removed) removedIds.push(r.transaction_id);

    nextCursor = page.next_cursor;
    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  return { added, modified, removedIds, nextCursor };
}

/**
 * Sync a single Plaid item for a user and persist the results.
 * `userTz` drives the `month` rollup key so months align with the user's tz.
 */
export async function syncItem(
  uid: string,
  item: PlaidItem,
  userTz: string,
): Promise<SyncCounts> {
  // Access token lives in the server-only private doc, keyed by itemId.
  const privateSnap = await db.doc(paths.privatePlaid(uid)).get();
  const accessToken = privateSnap.exists
    ? (privateSnap.get(item.itemId) as { accessToken?: string } | undefined)?.accessToken
    : undefined;
  if (!accessToken) {
    throw new Error(
      `No access token for item ${item.itemId} at ${paths.privatePlaid(uid)}[${item.itemId}]`,
    );
  }

  // The ORIGINAL page-1 cursor we restart from on a mutation-during-pagination.
  const originalCursor = item.cursor;

  let pages: AccumulatedPages | null = null;
  let restarts = 0;
  // First attempt + up to maxSyncRestarts retries.
  for (;;) {
    try {
      pages = await paginate(accessToken, originalCursor);
      break;
    } catch (err) {
      if (
        plaidErrorCode(err) === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' &&
        restarts < PIPELINE.maxSyncRestarts
      ) {
        restarts += 1;
        console.log(
          `[sync] ${uid}/${item.itemId}: mutation during pagination, restart ${restarts}/${PIPELINE.maxSyncRestarts}`,
        );
        continue;
      }
      throw err;
    }
  }

  // Narrow `pages` for strict mode: the loop above only breaks on success, but
  // TS can't prove non-null through the try/continue, so assert it explicitly.
  if (!pages) {
    throw new Error(`sync ${uid}/${item.itemId}: pagination produced no result`);
  }
  const { added, modified, removedIds, nextCursor } = pages;
  const upserts = [...added, ...modified];

  const txnsCol = db.collection(paths.transactions(uid));

  // ---- Pre-read existing docs for the upsert set so we can preserve
  // user-owned fields (categoryId/categoryName/notes/manualCategoryLock) and
  // set createdAt only on first insert. Firestore has no "merge but only if
  // absent" for individual fields, so we branch per-doc from a getAll read.
  const existing = new Set<string>();
  if (upserts.length > 0) {
    const refs = upserts.map((t) => txnsCol.doc(t.transaction_id));
    // getAll has no documented cap but keep reads chunked to be safe.
    for (let i = 0; i < refs.length; i += MAX_BATCH_OPS) {
      const slice = refs.slice(i, i + MAX_BATCH_OPS);
      const snaps = await db.getAll(...slice);
      for (const s of snaps) if (s.exists) existing.add(s.id);
    }
  }

  // ---- Batched writes (<= MAX_BATCH_OPS ops each). Only run after the full
  // pagination loop succeeded, so cursor + data commit together.
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };
  const bump = async () => {
    ops += 1;
    if (ops >= MAX_BATCH_OPS) await flush();
  };

  const now = FieldValue.serverTimestamp();

  for (const t of upserts) {
    const ref = txnsCol.doc(t.transaction_id);
    const date = parsePlaidDate(t.date);
    const merchant = t.merchant_name ?? null;
    const nameLower = `${t.name} ${merchant ?? ''}`.trim().toLowerCase();

    // Plaid-owned fields — always overwritten to reflect the latest state.
    const plaidFields = {
      plaidTxnId: t.transaction_id,
      accountId: t.account_id,
      itemId: item.itemId,
      date: Timestamp.fromDate(date),
      month: toMonthKey(date, userTz),
      amount: t.amount,
      isoCurrencyCode: t.iso_currency_code ?? null,
      name: t.name,
      merchantName: merchant,
      nameLower,
      pending: t.pending,
      isManual: false,
      updatedAt: now,
    };

    if (existing.has(t.transaction_id)) {
      // UPDATE: merge, never touch user-owned category/notes/lock fields.
      batch.set(ref, plaidFields, { merge: true });
    } else {
      // INSERT: seed user-owned fields as unclassified + set createdAt.
      batch.set(ref, {
        ...plaidFields,
        categoryId: null,
        categoryName: null,
        manualCategoryLock: false,
        notes: null,
        createdAt: now,
      });
    }
    await bump();
  }

  for (const id of removedIds) {
    batch.delete(txnsCol.doc(id));
    await bump();
  }

  await flush();

  // ---- Only now persist the cursor + lastSyncedAt so a crash mid-write replays.
  await db.doc(paths.plaidItem(uid, item.itemId)).set(
    {
      cursor: nextCursor,
      lastSyncedAt: now,
      status: 'good',
      error: null,
    },
    { merge: true },
  );

  return { added: added.length, modified: modified.length, removed: removedIds.length };
}
