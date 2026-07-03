/**
 * Domain types mirroring the Firestore data model.
 *
 * Firestore stores dates as Firestore `Timestamp` objects. To keep this package
 * free of a hard dependency on any particular SDK (firebase-admin vs firebase-js
 * expose different Timestamp classes), we model timestamps with a minimal
 * structural interface that both satisfy. Callers convert to/from `Date` at the
 * boundary.
 */

/** Structural shape shared by both firebase-admin and firebase-js Timestamps. */
export interface TimestampLike {
  toDate(): Date;
  toMillis(): number;
  seconds: number;
  nanoseconds: number;
}

/** `YYYY-MM` — used for cheap monthly rollups (single-equality query, no index). */
export type MonthKey = string;
/** `YYYY-MM-DD` — used as the doc id for daily insight documents. */
export type DateKey = string;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type AccountType =
  | 'depository'
  | 'credit'
  | 'loan'
  | 'investment'
  | 'other';

export type PlaidItemStatus = 'good' | 'login_required' | 'pending_expiration' | 'error';

/** Who created a category — AI (during nightly classify) or the user (manually). */
export type CreatedBy = 'ai' | 'user';

export type Platform = 'ios' | 'android' | 'web';

// ---------------------------------------------------------------------------
// Firestore documents
// ---------------------------------------------------------------------------

export interface NotifChannels {
  push: boolean;
}

export interface UserSettings {
  /** IANA tz, e.g. "America/Los_Angeles". Drives month boundaries + push timing. */
  tz: string;
  currency: string; // ISO 4217, e.g. "USD"
  notifChannels: NotifChannels;
}

/** `users/{uid}` */
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  settings: UserSettings;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/**
 * `users/{uid}/plaidItems/{itemId}`
 * The Plaid access token itself is NEVER stored here — only a reference. The
 * real token lives under `users/{uid}/_private/plaid` which rules deny to all
 * clients and only the Admin SDK reads.
 */
export interface PlaidItem {
  itemId: string;
  institutionName: string;
  institutionId: string | null;
  /** Path to the private doc field holding the access token (server-only). */
  accessTokenRef: string;
  /** Plaid `/transactions/sync` cursor. `null` before the first successful sync. */
  cursor: string | null;
  status: PlaidItemStatus;
  /** Set when Plaid reports ITEM_LOGIN_REQUIRED etc. so the app can prompt relink. */
  error: string | null;
  lastSyncedAt: TimestampLike | null;
  createdAt: TimestampLike;
}

/** `users/{uid}/accounts/{accountId}` */
export interface Account {
  accountId: string;
  itemId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: AccountType;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  isoCurrencyCode: string | null;
  updatedAt: TimestampLike;
}

/**
 * `users/{uid}/transactions/{plaidTxnId}`
 * Doc id === Plaid `transaction_id` so upserts are naturally idempotent.
 * `amount` is signed: positive = money leaving the account (spend), matching
 * Plaid's convention. We keep Plaid's sign so downstream math is unambiguous.
 */
export interface Transaction {
  plaidTxnId: string;
  accountId: string;
  itemId: string;
  date: TimestampLike;
  month: MonthKey;
  amount: number;
  isoCurrencyCode: string | null;
  name: string;
  merchantName: string | null;
  /** Lowercased `name` (+ merchant) for cheap client-side substring search. */
  nameLower: string;
  categoryId: string | null;
  categoryName: string | null;
  pending: boolean;
  /** When true, the nightly classifier must never overwrite the category. */
  manualCategoryLock: boolean;
  notes: string | null;
  /** True for user-entered manual transactions (no Plaid counterpart). */
  isManual: boolean;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/** `users/{uid}/categories/{categoryId}` */
export interface Category {
  categoryId: string;
  name: string;
  description: string | null;
  color: string; // hex, e.g. "#4F46E5"
  icon: string; // icon name (Ionicons/MaterialCommunityIcons)
  isArchived: boolean;
  createdBy: CreatedBy;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/**
 * `users/{uid}/budgets/{YYYY-MM}`
 * Per-category monthly caps plus an optional overall cap.
 */
export interface Budget {
  month: MonthKey;
  perCategory: Record<string, number>; // categoryId -> cap amount
  totalCap: number | null;
  updatedAt: TimestampLike;
}

/** A single AI suggestion inside an insight document. */
export interface InsightTip {
  id: string;
  title: string;
  body: string;
  /** Category this tip is about, if any (enables deep-linking). */
  categoryId: string | null;
  severity: 'info' | 'warn' | 'alert';
}

/** Compact stats snapshot the suggestion model reasons over (also shown in UI). */
export interface StatsSnapshot {
  month: MonthKey;
  monthToDateSpend: number;
  lastMonthSameDaySpend: number;
  momDeltaPct: number | null;
  perCategory: Array<{
    categoryId: string;
    categoryName: string;
    total: number;
    budget: number | null;
    consumedPct: number | null;
    wowDeltaPct: number | null;
  }>;
  topMerchants: Array<{ merchantName: string; total: number; count: number }>;
  /** Linear projection of month-end spend from the current pace. */
  projectedMonthEndSpend: number;
}

/** `users/{uid}/insights/{YYYY-MM-DD}` */
export interface Insight {
  date: DateKey;
  tips: InsightTip[];
  stats: StatsSnapshot;
  /** True once the push notification for this insight was sent. */
  delivered: boolean;
  createdAt: TimestampLike;
}

/** `users/{uid}/pushTokens/{tokenId}` */
export interface PushToken {
  tokenId: string;
  expoToken: string;
  platform: Platform;
  lastSeen: TimestampLike;
}

/** `users/{uid}/syncState/state` — pipeline bookkeeping (per-user). */
export interface SyncState {
  lastRunAt: TimestampLike | null;
  lastRunStatus: 'ok' | 'partial' | 'error' | null;
  lastError: string | null;
  runCount: number;
}

// ---------------------------------------------------------------------------
// Cloud Function request/response contracts
// ---------------------------------------------------------------------------

export interface CreateLinkTokenResponse {
  linkToken: string;
  expiration: string;
}

export interface ExchangePublicTokenRequest {
  publicToken: string;
  /** Optional metadata returned by Plaid Link onSuccess. */
  institutionName?: string;
  institutionId?: string;
}

export interface ExchangePublicTokenResponse {
  itemId: string;
  institutionName: string;
  accountsLinked: number;
}
