/**
 * Zod schemas for everything crossing a trust boundary:
 *  - Plaid API payloads (accounts, transactions)
 *  - Gemini structured JSON responses (classification, suggestions)
 *  - Cloud Function request bodies
 *
 * Parse with `.parse()` (throw) at ingestion points so malformed upstream data
 * never reaches Firestore or the UI.
 */
import { z } from 'zod';
import { NEW_CATEGORY_SENTINEL } from './constants';

// ---------------------------------------------------------------------------
// Plaid — subset of fields we actually persist. Unknown fields are ignored.
// ---------------------------------------------------------------------------

export const plaidAccountSchema = z.object({
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
export type PlaidAccount = z.infer<typeof plaidAccountSchema>;

export const plaidTransactionSchema = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  amount: z.number(),
  iso_currency_code: z.string().nullable().optional(),
  date: z.string(), // "YYYY-MM-DD"
  datetime: z.string().nullable().optional(),
  name: z.string(),
  merchant_name: z.string().nullable().optional(),
  pending: z.boolean(),
  pending_transaction_id: z.string().nullable().optional(),
});
export type PlaidTransaction = z.infer<typeof plaidTransactionSchema>;

export const plaidSyncResponseSchema = z.object({
  added: z.array(plaidTransactionSchema),
  modified: z.array(plaidTransactionSchema),
  removed: z.array(z.object({ transaction_id: z.string() })),
  next_cursor: z.string(),
  has_more: z.boolean(),
});
export type PlaidSyncResponse = z.infer<typeof plaidSyncResponseSchema>;

// ---------------------------------------------------------------------------
// Gemini — classification. Model returns one entry per input transaction, in
// order. `categoryName` is either an existing category name (from the enum we
// pass in) or the NEW_CATEGORY_SENTINEL, in which case `newCategory` is set.
// ---------------------------------------------------------------------------

export const geminiClassificationItemSchema = z.object({
  txnId: z.string(),
  categoryName: z.string(),
  /** Present only when categoryName === NEW_CATEGORY_SENTINEL. */
  newCategory: z
    .object({
      name: z.string().min(1).max(40),
      description: z.string().max(120).optional(),
    })
    .nullable()
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type GeminiClassificationItem = z.infer<typeof geminiClassificationItemSchema>;

export const geminiClassificationResponseSchema = z.object({
  items: z.array(geminiClassificationItemSchema),
});
export type GeminiClassificationResponse = z.infer<typeof geminiClassificationResponseSchema>;

/** Runtime guard: sentinel implies a newCategory payload. */
export function classificationNeedsNewCategory(item: GeminiClassificationItem): boolean {
  return item.categoryName === NEW_CATEGORY_SENTINEL;
}

// ---------------------------------------------------------------------------
// Gemini — suggestions
// ---------------------------------------------------------------------------

export const geminiSuggestionSchema = z.object({
  tips: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        body: z.string().min(1).max(400),
        categoryName: z.string().nullable().optional(),
        severity: z.enum(['info', 'warn', 'alert']),
      }),
    )
    .max(3),
});
export type GeminiSuggestionResponse = z.infer<typeof geminiSuggestionSchema>;

// ---------------------------------------------------------------------------
// Cloud Function request bodies
// ---------------------------------------------------------------------------

export const exchangePublicTokenRequestSchema = z.object({
  publicToken: z.string().min(1),
  institutionName: z.string().optional(),
  institutionId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Client-writable transaction edit payload (recategorize / notes / manual add).
// The app validates before writing; rules enforce the same shape server-side
// where possible. Keeping it here means app + tests share one definition.
// ---------------------------------------------------------------------------

export const transactionEditSchema = z.object({
  categoryId: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  manualCategoryLock: z.boolean().optional(),
});
export type TransactionEdit = z.infer<typeof transactionEditSchema>;

export const manualTransactionSchema = z.object({
  accountId: z.string(),
  date: z.string(), // "YYYY-MM-DD"
  amount: z.number(),
  name: z.string().min(1).max(140),
  categoryId: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type ManualTransactionInput = z.infer<typeof manualTransactionSchema>;

export const budgetEditSchema = z.object({
  perCategory: z.record(z.string(), z.number().nonnegative()),
  totalCap: z.number().nonnegative().nullable().optional(),
});
export type BudgetEdit = z.infer<typeof budgetEditSchema>;
