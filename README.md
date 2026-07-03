# Expense Manager

A personal, multi-tenant expense manager. It links your bank accounts through
**Plaid**, pulls transactions on a nightly schedule, classifies them into
categories with **Gemini**, computes spend/budget statistics, and surfaces
insights and push notifications in a native **Expo** app backed by
**Firebase** (Auth + Firestore + Cloud Functions).

Everything is keyed per user (`users/{uid}/...` in Firestore) so multiple people
can use the same deployment without seeing each other's data — Firestore
security rules enforce this at the boundary.

---

## Architecture

```
                         ┌───────────────────────────────────────────┐
                         │                Expo App                    │
                         │  (iOS / Android dev client, expo-router)    │
                         │                                             │
                         │  Google Sign-In ──▶ Firebase Auth (ID tok)  │
                         │  TanStack Query ──▶ Firestore (reads)       │
                         │  Plaid Link SDK ──▶ callable Functions      │
                         └───────┬───────────────────────┬────────────┘
                                 │ callable HTTPS         │ reads
                                 ▼                        ▼
        ┌────────────────────────────────────┐   ┌──────────────────────────┐
        │      Cloud Functions (gen 2)       │   │        Firestore          │
        │                                    │   │  users/{uid}/             │
        │  createLinkToken                   │   │    plaidItems, accounts,  │
        │  exchangePublicToken  ──────────┐  │   │    transactions,          │
        │  unlinkItem                     │  │   │    categories, budgets,   │
        │  plaidWebhook (best-effort ack) │  │   │    insights, pushTokens,  │
        │                                 │  │   │    syncState              │
        │  writes item + access_token     │  │   │    _private/plaid (server │
        │  to users/{uid}/_private/plaid ─┼──┼──▶│      only; rules DENY)    │
        │                                 │  │   └────────────┬──────────────┘
        │  nightlyPipeline  ◀── Cloud     │  │                │ admin SDK R/W
        │  (scheduled, 08:17 UTC)         │  │                │ (ADC, no key)
        │   sync▶classify▶stats▶suggest▶notify │────────────▶─┘
        └───────┬───────────────────────┬───┘
                │ Plaid /sync            │ Gemini API
                ▼                        ▼
          ┌───────────┐            ┌───────────┐
          │   Plaid   │            │  Gemini   │
          └───────────┘            └───────────┘
```

**Data flow in one breath:** you link a bank in the app → the `exchangePublicToken`
Cloud Function swaps the Plaid public token and stores the access token
server-side (`_private/plaid`) → the **`nightlyPipeline` scheduled Cloud Function**
calls Plaid `/transactions/sync`, classifies new transactions with Gemini, rolls
up per-category and per-month stats, asks Gemini for up to three insight tips, and
sends push notifications → the app reads all of it from Firestore via TanStack
Query.

**Why the nightly job is a scheduled Cloud Function (not GitHub Actions):** it
runs on Cloud Scheduler using the function's **own** service account via
Application Default Credentials — there is no downloaded service-account key and
no GitHub secret to manage or rotate. Cloud Scheduler is also more punctual than
GitHub's cron. The `/transactions/sync` cursor is stored per item, so a missed or
late run simply catches up on the next run (the sync is idempotent by
`transaction_id`).

**Two deployables + one shared package:**

| Package | Where it runs | Reads config from | Responsibility |
| --- | --- | --- | --- |
| `app/` | User devices (Expo dev client) | `EXPO_PUBLIC_*` in `app/.env` | UI, auth, Plaid Link, reads/edits |
| `functions/` | Firebase Cloud Functions | Firebase secrets + `functions/.env` | Plaid token exchange/unlink, webhook, **and the nightly pipeline** (`src/pipeline/*`) |
| `packages/shared` | imported by both | — | Types, zod schemas, Firestore paths, date/constant helpers |

`functions/` is standalone (not a workspace member) so `firebase deploy` stays
clean; it bundles `@expense/shared` at build time with esbuild.

The Plaid access token never touches the client: it lives in
`users/{uid}/_private/plaid`, which the Firestore rules deny to all client reads
and is only accessed server-side by the Functions via the Admin SDK.

---

## Monorepo layout

```
expense-manager/
├── app/                  Expo app (expo-router). Path alias '@/...' -> app/src/...
│   ├── app/              Route files (screens); each default-exports a component
│   ├── src/              components, hooks, lib, theme
│   ├── app.config.ts     Dynamic Expo config (reads EXPO_PUBLIC_*)
│   ├── eas.json          EAS build profiles (development / preview / production)
│   └── .env.example      Client env template -> copy to app/.env
├── functions/            Firebase Cloud Functions (standalone; esbuild-bundled)
│   └── src/
│       ├── index.ts      createLinkToken, exchangePublicToken, unlinkItem,
│       │                 plaidWebhook, nightlyPipeline (scheduled)
│       ├── admin.ts      firebase-admin app (ADC, shared by all functions)
│       ├── plaidClient.ts Plaid client + secret/param declarations
│       └── pipeline/     sync -> classify -> stats -> suggest -> notify, run, local
├── packages/
│   └── shared/           @expense/shared: types, zod schemas, paths, date utils, constants
├── firestore.rules       Per-user security rules (_private/** denied to clients)
├── firestore.indexes.json
├── firebase.json         Firestore + Functions + emulator config
├── .env.example          Root env template (documents all config)
├── README.md             You are here
└── SETUP.md              Step-by-step first-time setup
```

The `@expense/shared` package is the single source of truth for Firestore paths,
domain types, zod schemas, and date helpers. The app and functions both import
it, so `npm run build:shared` must run before typechecking or bundling.

**Money sign convention (Plaid):** `amount > 0` is spend (money out),
`amount < 0` is income (money in). Spend totals sum the positive amounts.

---

## Quickstart

First-time setup (Firebase project, OAuth clients, Plaid/Gemini keys, secrets,
and building a dev client on device) is documented step by step in
**[SETUP.md](./SETUP.md)** — start there.

Once your `app/.env` and Firebase secrets are in place:

```bash
npm install                 # installs the app + shared workspaces
npm --prefix functions install   # functions is standalone
npm run build:shared        # compile @expense/shared (required first)

# Run the app on a device (a custom dev client is required — not Expo Go):
npx expo prebuild --clean   # from app/, or: npm --workspace app run prebuild
npm --workspace app run ios       # or: run android

# Deploy backend (also provisions the nightlyPipeline Cloud Scheduler job):
firebase deploy --only functions,firestore:rules,firestore:indexes

# Run the nightly pipeline locally against your data (needs ADC + Plaid/Gemini env):
npm run pipeline:local
```

The nightly pipeline runs automatically at **08:17 UTC** via Cloud Scheduler; you
can force a run from the Cloud Scheduler console or CLI. See **SETUP.md** step 9.

## Useful root scripts

| Command | What it does |
| --- | --- |
| `npm run build:shared` | Compile the `@expense/shared` package |
| `npm run typecheck` | Typecheck shared + app |
| `npm run typecheck:functions` | Build shared, then typecheck the Functions |
| `npm run app` | Start the Expo dev server (dev client) |
| `npm run pipeline:local` | Run the nightly pipeline locally (`functions` tsx runner) |
| `npm run functions:serve` | Serve Functions in the Firebase emulator |
