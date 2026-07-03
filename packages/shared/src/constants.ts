/** Shared constants: Firestore paths, model ids, seed data, and pipeline tunables. */

// ---------------------------------------------------------------------------
// Firestore collection / document paths (single source of truth)
// ---------------------------------------------------------------------------

export const paths = {
  user: (uid: string) => `users/${uid}`,
  plaidItems: (uid: string) => `users/${uid}/plaidItems`,
  plaidItem: (uid: string, itemId: string) => `users/${uid}/plaidItems/${itemId}`,
  accounts: (uid: string) => `users/${uid}/accounts`,
  account: (uid: string, accountId: string) => `users/${uid}/accounts/${accountId}`,
  transactions: (uid: string) => `users/${uid}/transactions`,
  transaction: (uid: string, txnId: string) => `users/${uid}/transactions/${txnId}`,
  categories: (uid: string) => `users/${uid}/categories`,
  category: (uid: string, categoryId: string) => `users/${uid}/categories/${categoryId}`,
  budgets: (uid: string) => `users/${uid}/budgets`,
  budget: (uid: string, month: string) => `users/${uid}/budgets/${month}`,
  insights: (uid: string) => `users/${uid}/insights`,
  insight: (uid: string, date: string) => `users/${uid}/insights/${date}`,
  pushTokens: (uid: string) => `users/${uid}/pushTokens`,
  pushToken: (uid: string, tokenId: string) => `users/${uid}/pushTokens/${tokenId}`,
  syncState: (uid: string) => `users/${uid}/syncState/state`,
  /** Server-only. Rules DENY all client access. */
  privatePlaid: (uid: string) => `users/${uid}/_private/plaid`,
} as const;

// ---------------------------------------------------------------------------
// Gemini models (per design: cheap for classify, capable for suggest)
// ---------------------------------------------------------------------------

export const GEMINI_MODELS = {
  classify: 'gemini-2.5-flash-lite',
  suggest: 'gemini-2.5-flash',
} as const;

/** Sentinel the classifier returns when no existing category fits. */
export const NEW_CATEGORY_SENTINEL = '__NEW__';

// ---------------------------------------------------------------------------
// Pipeline tunables
// ---------------------------------------------------------------------------

export const PIPELINE = {
  /** Max transactions per Gemini classify batch call. */
  classifyBatchSize: 50,
  /** Max AI suggestions produced per day. */
  maxTipsPerDay: 3,
  /** A category is "spiking" if its WoW delta exceeds this fraction. */
  spikeThresholdPct: 0.4,
  /** Warn when a category budget is consumed past this fraction, month-to-date. */
  budgetWarnPct: 0.85,
  /** Plaid sync restarts from page-1 cursor at most this many times per item. */
  maxSyncRestarts: 3,
} as const;

// ---------------------------------------------------------------------------
// Seed categories created for every new user on first sign-in.
// createdBy: 'user' so the archive/rename rules treat them as user-owned.
// ---------------------------------------------------------------------------

export interface SeedCategory {
  slug: string;
  name: string;
  color: string;
  icon: string;
  description: string;
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { slug: 'groceries', name: 'Groceries', color: '#16A34A', icon: 'cart', description: 'Supermarkets and food shopping' },
  { slug: 'dining', name: 'Dining & Takeout', color: '#EA580C', icon: 'restaurant', description: 'Restaurants, cafes, delivery' },
  { slug: 'transport', name: 'Transport', color: '#2563EB', icon: 'car', description: 'Fuel, transit, rideshare, parking' },
  { slug: 'housing', name: 'Housing & Utilities', color: '#7C3AED', icon: 'home', description: 'Rent, mortgage, electricity, water, internet' },
  { slug: 'shopping', name: 'Shopping', color: '#DB2777', icon: 'bag-handle', description: 'Retail, clothing, general goods' },
  { slug: 'entertainment', name: 'Entertainment', color: '#DC2626', icon: 'game-controller', description: 'Streaming, events, hobbies' },
  { slug: 'health', name: 'Health & Fitness', color: '#0D9488', icon: 'fitness', description: 'Pharmacy, doctor, gym' },
  { slug: 'travel', name: 'Travel', color: '#0891B2', icon: 'airplane', description: 'Flights, hotels, trips' },
  { slug: 'subscriptions', name: 'Subscriptions', color: '#4F46E5', icon: 'repeat', description: 'Recurring memberships and services' },
  { slug: 'income', name: 'Income', color: '#059669', icon: 'trending-up', description: 'Salary, deposits, refunds' },
  { slug: 'transfers', name: 'Transfers', color: '#64748B', icon: 'swap-horizontal', description: 'Account-to-account movement' },
  { slug: 'fees', name: 'Fees & Charges', color: '#B91C1C', icon: 'alert-circle', description: 'Bank fees, interest, penalties' },
  { slug: 'other', name: 'Other', color: '#94A3B8', icon: 'ellipsis-horizontal', description: 'Uncategorized' },
];

/** Fallback color palette for AI-created categories (cycled by index). */
export const CATEGORY_PALETTE = [
  '#4F46E5', '#0891B2', '#16A34A', '#EA580C', '#DB2777',
  '#7C3AED', '#DC2626', '#0D9488', '#CA8A04', '#2563EB',
];
