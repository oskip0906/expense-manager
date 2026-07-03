/**
 * Firebase Cloud Functions for the Expense Manager app.
 *
 * This package is standalone (NOT a workspace member) so `firebase deploy` can
 * bundle it in isolation; it therefore duplicates the few shared shapes it
 * needs (Firestore paths + a couple of zod schemas) rather than importing
 * @expense/shared.
 *
 * Responsibilities: Plaid Link lifecycle (create link token, exchange public
 * token, unlink item) and a best-effort Plaid webhook. Transaction syncing,
 * classification and insights all happen in the nightly pipeline — the webhook
 * only drops a hint; the nightly job is the source of truth.
 */
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue } from './admin';
import {
  GEMINI_API_KEY,
  PLAID_CLIENT_ID,
  PLAID_SECRET,
  getPlaidClient,
  plaidCountryCodes,
  plaidProducts,
  plaidWebhookUrl,
} from './plaidClient';
import { runPipeline } from './pipeline/run';
import type { CountryCode, Products } from 'plaid';

const REGION = 'us-central1';
const CALLABLE_OPTS = {
  region: REGION,
  secrets: [PLAID_CLIENT_ID, PLAID_SECRET],
} as const;

// ---------------------------------------------------------------------------
// Firestore paths — kept in sync with @expense/shared `paths`. This package is
// standalone and cannot import the shared module, so we redeclare the handful
// we use here.
// ---------------------------------------------------------------------------

const paths = {
  account: (uid: string, accountId: string) => `users/${uid}/accounts/${accountId}`,
  plaidItem: (uid: string, itemId: string) => `users/${uid}/plaidItems/${itemId}`,
  syncState: (uid: string) => `users/${uid}/syncState/state`,
  /** Server-only. Client security rules DENY all access to this doc. */
  privatePlaid: (uid: string) => `users/${uid}/_private/plaid`,
} as const;

// ---------------------------------------------------------------------------
// Validation — local copies of the relevant @expense/shared zod schemas.
// ---------------------------------------------------------------------------

const exchangePublicTokenRequestSchema = z.object({
  publicToken: z.string().min(1),
  institutionName: z.string().optional(),
  institutionId: z.string().optional(),
});

const unlinkItemRequestSchema = z.object({
  itemId: z.string().min(1),
});

/** Subset of a Plaid account we persist (mirrors shared `plaidAccountSchema`). */
const plaidAccountSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  official_name: z.string().nullable().optional(),
  mask: z.string().nullable().optional(),
  type: z.string(),
  subtype: z.string().nullable().optional(),
  balances: z.object({
    current: z.number().nullable().optional(),
    available: z.number().nullable().optional(),
    iso_currency_code: z.string().nullable().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable message from a Plaid SDK error (axios-shaped) and
 * rethrow as an HttpsError the client can surface. Logs the full error for ops.
 */
function plaidError(context: string, err: unknown): never {
  const anyErr = err as { response?: { data?: { error_message?: string; error_code?: string } }; message?: string };
  const data = anyErr?.response?.data;
  const message = data?.error_message ?? anyErr?.message ?? 'Unknown Plaid error';
  logger.error(`${context} failed`, {
    error_code: data?.error_code,
    error_message: data?.error_message,
    message: anyErr?.message,
  });
  throw new HttpsError('internal', `${context}: ${message}`);
}

/** Map a Plaid account `type` string to our AccountType union, defaulting to 'other'. */
function normalizeAccountType(type: string): string {
  const allowed = ['depository', 'credit', 'loan', 'investment', 'other'];
  return allowed.includes(type) ? type : 'other';
}

// ---------------------------------------------------------------------------
// 1) createLinkToken — mint a Plaid Link token for the signed-in user.
// ---------------------------------------------------------------------------

export const createLinkToken = onCall(CALLABLE_OPTS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const plaid = getPlaidClient();
  const webhook = plaidWebhookUrl();

  try {
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: uid },
      client_name: 'Expense Manager',
      products: plaidProducts() as Products[],
      country_codes: plaidCountryCodes() as CountryCode[],
      language: 'en',
      ...(webhook ? { webhook } : {}),
    });
    return {
      linkToken: res.data.link_token,
      expiration: res.data.expiration,
    };
  } catch (err) {
    plaidError('createLinkToken', err);
  }
});

// ---------------------------------------------------------------------------
// 2) exchangePublicToken — swap Link's public_token for an access_token, store
//    it server-side only, and materialize the item + accounts in Firestore.
// ---------------------------------------------------------------------------

export const exchangePublicToken = onCall(CALLABLE_OPTS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const parsed = exchangePublicTokenRequestSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid exchange payload.', parsed.error.flatten());
  }
  const { publicToken, institutionName, institutionId } = parsed.data;

  const plaid = getPlaidClient();

  let accessToken: string;
  let itemId: string;
  try {
    const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    accessToken = exchange.data.access_token;
    itemId = exchange.data.item_id;
  } catch (err) {
    plaidError('exchangePublicToken', err);
  }

  // Persist the access token ONLY under the server-only private doc, keyed by
  // itemId so a user can link multiple institutions. Merge to preserve others.
  const privateRef = db.doc(paths.privatePlaid(uid));
  await privateRef.set(
    {
      [itemId]: {
        accessToken,
        itemId,
        createdAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  const resolvedInstitutionName = institutionName ?? 'Bank';

  // Write the client-visible plaidItem doc BEFORE fetching accounts. It carries
  // no secret, and writing it first means an accountsGet failure still leaves a
  // syncable, unlinkable item (the nightly sync backfills accounts) rather than
  // an orphaned access token the user can neither see nor remove.
  await db.doc(paths.plaidItem(uid, itemId)).set({
    itemId,
    institutionName: resolvedInstitutionName,
    institutionId: institutionId ?? null,
    accessTokenRef: paths.privatePlaid(uid),
    cursor: null,
    status: 'good',
    error: null,
    lastSyncedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Fetch accounts for this item and write each account doc (best-effort — the
  // nightly sync also refreshes balances, so a failure here is non-fatal).
  let accountsLinked = 0;
  try {
    const accountsRes = await plaid.accountsGet({ access_token: accessToken });
    const accounts = accountsRes.data.accounts;

    const batch = db.batch();
    for (const raw of accounts) {
      const acct = plaidAccountSchema.parse(raw);
      const ref = db.doc(paths.account(uid, acct.account_id));
      batch.set(
        ref,
        {
          accountId: acct.account_id,
          itemId,
          name: acct.name,
          officialName: acct.official_name ?? null,
          mask: acct.mask ?? null,
          type: normalizeAccountType(acct.type),
          subtype: acct.subtype ?? null,
          currentBalance: acct.balances.current ?? null,
          availableBalance: acct.balances.available ?? null,
          isoCurrencyCode: acct.balances.iso_currency_code ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      accountsLinked += 1;
    }
    await batch.commit();
  } catch (err) {
    logger.warn('exchangePublicToken.accountsGet failed; nightly sync will backfill', {
      error: String(err),
    });
  }

  return {
    itemId,
    institutionName: resolvedInstitutionName,
    accountsLinked,
  };
});

// ---------------------------------------------------------------------------
// 3) unlinkItem — remove a linked institution at Plaid + Firestore.
//    Transactions are intentionally left intact (history is preserved).
// ---------------------------------------------------------------------------

export const unlinkItem = onCall(CALLABLE_OPTS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const parsed = unlinkItemRequestSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'itemId is required.', parsed.error.flatten());
  }
  const { itemId } = parsed.data;

  // Read the access token from the server-only private doc.
  const privateSnap = await db.doc(paths.privatePlaid(uid)).get();
  const entry = privateSnap.get(itemId) as { accessToken?: string } | undefined;
  const accessToken = entry?.accessToken;
  if (!accessToken) {
    throw new HttpsError('not-found', 'No linked item found for this itemId.');
  }

  const plaid = getPlaidClient();
  try {
    await plaid.itemRemove({ access_token: accessToken });
  } catch (err) {
    // If Plaid removal fails we still surface it — Firestore cleanup below only
    // runs on success so the token reference is not orphaned prematurely.
    plaidError('unlinkItem', err);
  }

  // Delete the plaidItem doc and this item's accounts.
  const batch = db.batch();
  batch.delete(db.doc(paths.plaidItem(uid, itemId)));

  const accountsSnap = await db
    .collection(`users/${uid}/accounts`)
    .where('itemId', '==', itemId)
    .get();
  for (const doc of accountsSnap.docs) {
    batch.delete(doc.ref);
  }

  // Remove only this item's key from the private token map.
  batch.set(
    db.doc(paths.privatePlaid(uid)),
    { [itemId]: FieldValue.delete() },
    { merge: true },
  );

  await batch.commit();

  return { ok: true };
});

// ---------------------------------------------------------------------------
// 4) plaidWebhook — best-effort notification that new transactions are ready.
//    We only drop a hint on the user's syncState; the NIGHTLY JOB IS THE SOURCE
//    OF TRUTH and will reconcile via /transactions/sync regardless. We always
//    respond 200 quickly so Plaid does not retry.
// ---------------------------------------------------------------------------

export const plaidWebhook = onRequest({ region: REGION }, async (req, res) => {
  // Best-effort acknowledgement. The scheduled nightlyPipeline is the source of
  // truth for syncing, so we just log the notification and return 200 quickly so
  // Plaid does not retry. (Real-time triggering could be wired here later.)
  const body = (req.body ?? {}) as {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
  };
  logger.info('plaidWebhook received', {
    type: body.webhook_type,
    code: body.webhook_code,
    item_id: body.item_id,
  });
  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------------
// 5) nightlyPipeline — scheduled Cloud Function that syncs Plaid, classifies
//    with Gemini, computes stats, and writes/pushes daily insights for every
//    user. Runs on Cloud Scheduler using the function's OWN service account
//    (Application Default Credentials) — no downloaded key, no GitHub secret.
//    The heavy lifting lives in src/pipeline/*. timeoutSeconds is the gen-2
//    event-function max (540s); at personal scale this is ample.
// ---------------------------------------------------------------------------

export const nightlyPipeline = onSchedule(
  {
    schedule: '17 8 * * *',
    timeZone: 'Etc/UTC',
    region: REGION,
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, GEMINI_API_KEY],
  },
  async () => {
    await runPipeline();
  },
);
