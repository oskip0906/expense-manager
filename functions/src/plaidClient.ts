/**
 * Plaid API client, wired from firebase-functions params/secrets.
 *
 * Secrets (PLAID_CLIENT_ID / PLAID_SECRET) are set with
 *   `firebase functions:secrets:set PLAID_CLIENT_ID`
 * and attached to each function via the `secrets` runWith option. Non-secret
 * params (env, products, country codes, webhook) are plain params with sane
 * defaults so the sandbox works out of the box.
 */
import { defineSecret, defineString } from 'firebase-functions/params';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

// Secrets — never printed, injected at runtime only for functions that list them.
export const PLAID_CLIENT_ID = defineSecret('PLAID_CLIENT_ID');
export const PLAID_SECRET = defineSecret('PLAID_SECRET');
// Used by the scheduled nightly pipeline (Gemini classification + suggestions).
export const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// Non-secret configuration params.
export const PLAID_ENV = defineString('PLAID_ENV', { default: 'sandbox' });
export const PLAID_PRODUCTS = defineString('PLAID_PRODUCTS', { default: 'transactions' });
export const PLAID_COUNTRY_CODES = defineString('PLAID_COUNTRY_CODES', { default: 'US' });
export const PLAID_WEBHOOK_URL = defineString('PLAID_WEBHOOK_URL', { default: '' });

/** Split a comma-separated param into a trimmed, non-empty string array. */
function csv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Plaid `products` for linkTokenCreate (e.g. ['transactions']). */
export function plaidProducts(): string[] {
  return csv(PLAID_PRODUCTS.value());
}

/** Plaid `country_codes` for linkTokenCreate (e.g. ['US']). */
export function plaidCountryCodes(): string[] {
  return csv(PLAID_COUNTRY_CODES.value());
}

/** The configured webhook URL, or undefined when unset. */
export function plaidWebhookUrl(): string | undefined {
  const url = PLAID_WEBHOOK_URL.value().trim();
  return url.length > 0 ? url : undefined;
}

/**
 * Build a PlaidApi client for the configured environment. Cheap to construct;
 * we memoize by resolved base path so repeated invocations in a warm instance
 * reuse the same client.
 */
let cached: { basePath: string; client: PlaidApi } | undefined;

export function getPlaidClient(): PlaidApi {
  const env = PLAID_ENV.value().trim() || 'sandbox';
  const basePath = PlaidEnvironments[env] ?? PlaidEnvironments.sandbox;

  if (cached && cached.basePath === basePath) {
    return cached.client;
  }

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': PLAID_CLIENT_ID.value(),
        'PLAID-SECRET': PLAID_SECRET.value(),
        // Pin the API version so response shapes are stable across SDK upgrades.
        'Plaid-Version': '2020-09-14',
      },
    },
  });

  const client = new PlaidApi(configuration);
  cached = { basePath, client };
  return client;
}
