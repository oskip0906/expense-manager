# Setup

Step-by-step first-time setup for the Expense Manager. Follow the steps in
order — later steps depend on values you collect in earlier ones. Budget about
an hour for the first run, most of which is waiting on Firebase and building the
dev client.

Prerequisites: Node 20+, the Firebase CLI (`npm i -g firebase-tools`), the EAS /
Expo CLI (used via `npx`), and Xcode (for iOS) and/or Android Studio (for
Android). You need Plaid, Google Cloud / Firebase, and Google AI Studio accounts.

> Money sign convention: `amount > 0` = spend, `amount < 0` = income.

---

## 1. Create the Firebase project (Blaze plan + $5 budget alert)

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   **Add project**. Note the **Project ID** — you'll use it everywhere.
2. Upgrade the project to the **Blaze (pay-as-you-go)** plan. Cloud Functions
   and outbound network calls (Plaid, Gemini) require Blaze; the free Spark plan
   blocks them.
3. Set a spending guardrail so a runaway loop can't surprise you:
   - In the [Google Cloud console](https://console.cloud.google.com/billing) for
     the same project, open **Billing → Budgets & alerts → Create budget**.
   - Scope it to this project, set the amount to **$5/month**, and add alert
     thresholds (e.g. 50% / 90% / 100%). This only emails you — it does not cap
     spend — but it's your early-warning system.
4. In the Firebase console, enable **Firestore Database** (production mode). The
   security rules in `firestore.rules` will be deployed in step 6.
5. Put your project id into `.firebaserc` (replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID`):

   ```bash
   firebase use --add    # pick your project, alias it "default"
   ```

## 2. Enable Google auth + collect OAuth client ids + download config files

1. In **Firebase console → Authentication → Sign-in method**, enable **Google**.
2. In **Project settings → General → Your apps**, register:
   - A **Web app** — copy its config (apiKey, authDomain, projectId,
     storageBucket, messagingSenderId, appId). These become the
     `EXPO_PUBLIC_FIREBASE_*` values.
   - An **iOS app** with bundle id `com.opang.expensemanager` — download
     **`GoogleService-Info.plist`** into `app/`.
   - An **Android app** with package `com.opang.expensemanager` — download
     **`google-services.json`** into `app/`.
   (Both files are git-ignored; the bundle id / package come from
   `app/app.config.ts`.)
3. Get the OAuth **client IDs** from the
   [Google Cloud console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
   for the same project:
   - **Web client ID** → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (this is the one
     Firebase uses to mint the ID token).
   - **iOS client ID** → `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
   - The **reversed iOS client id** (`REVERSED_CLIENT_ID` inside
     `GoogleService-Info.plist`, e.g. `com.googleusercontent.apps.123-abc`) →
     `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`.

## 3. Plaid dashboard: keys + products

1. Create an account at the [Plaid dashboard](https://dashboard.plaid.com/).
2. Under **Developers → Keys**, copy the **client_id** and the **secret** for
   the environment you'll use (Sandbox is free; the Trial plan also offers
   `development`/`production`).
3. Under **Team Settings → Products**, make sure **Transactions** is enabled.
4. You'll use these values as `PLAID_CLIENT_ID`, `PLAID_SECRET`,
   `PLAID_ENV` (`sandbox` | `development` | `production`),
   `PLAID_PRODUCTS` (`transactions`), and `PLAID_COUNTRY_CODES` (`US`).
   These are **server-only** secrets — they never go in `app/.env`.

## 4. Gemini API key

1. Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. This is `GEMINI_API_KEY` — also **server-only** (used by the pipeline; the
   Functions may use it too). The pipeline uses the
   [`@google/genai`](https://www.npmjs.com/package/@google/genai) SDK pinned to
   `^2.0.0`. If that version is unavailable in your environment, install the
   latest published version instead (`npm i @google/genai@latest`) and reconcile
   any small API differences.

## 5. Fill `app/.env`

Copy the template and paste in the client-safe values from steps 1–2:

```bash
cp app/.env.example app/.env
```

Fill every `EXPO_PUBLIC_*` value:

- `EXPO_PUBLIC_FIREBASE_*` — from the Web app config (step 2).
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`,
  `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` — from step 2.
- `EXPO_PUBLIC_EAS_PROJECT_ID` — from step 8 after `eas init` (or leave blank
  until then).
- `EXPO_PUBLIC_FUNCTIONS_REGION` — the region your Functions deploy to
  (default `us-central1`).

Nothing secret goes in `app/.env`. Plaid and Gemini keys live in Firebase
secrets (step 6). There are **no** GitHub Actions secrets and **no** downloaded
service-account key — the nightly job runs as a scheduled Cloud Function using
the function's own credentials.

## 6. Deploy the backend (Functions incl. the nightly pipeline + rules/indexes)

The nightly pipeline is a **scheduled Cloud Function** (`nightlyPipeline`), not a
GitHub Action. It deploys with the rest of the Functions and runs on Cloud
Scheduler using the function's own service account — **no key to download, no
GitHub secret to manage.**

1. Store the server-only secrets so the Functions can read them at runtime.
   `GEMINI_API_KEY` is **required** (the nightly pipeline classifies + suggests
   with it):

   ```bash
   firebase functions:secrets:set PLAID_CLIENT_ID
   firebase functions:secrets:set PLAID_SECRET
   firebase functions:secrets:set GEMINI_API_KEY
   ```

2. Configure the non-secret Plaid params. Create `functions/.env` (git-ignored;
   deployed as the Functions' runtime environment):

   ```dotenv
   # functions/.env
   PLAID_ENV=sandbox            # sandbox | development | production
   PLAID_PRODUCTS=transactions
   PLAID_COUNTRY_CODES=US
   # PLAID_WEBHOOK_URL=https://<region>-<project>.cloudfunctions.net/plaidWebhook
   ```

3. Install the Functions deps (this package is standalone — not part of the root
   workspaces — and bundles `@expense/shared` at build time via esbuild):

   ```bash
   npm install            # repo root (app + shared)
   npm --prefix functions install
   ```

4. Deploy the backend (this builds `@expense/shared`, typechecks, esbuild-bundles
   the Functions, and provisions the Cloud Scheduler job for `nightlyPipeline`):

   ```bash
   firebase deploy --only functions,firestore:rules,firestore:indexes
   ```

   After the first deploy, confirm the callable Functions' region matches
   `EXPO_PUBLIC_FUNCTIONS_REGION` in `app/.env` (default `us-central1`). If you
   set a Plaid webhook, point `PLAID_WEBHOOK_URL` at the deployed `plaidWebhook`
   URL and redeploy.

## 7. (Optional) Least-privilege runtime service account

By default `nightlyPipeline` runs as the project's default compute service
account, which can read/write Firestore. To tighten it, create a dedicated
service account with **only** `roles/datastore.user` and set it as the
function's runtime identity (Cloud console → the function → **Edit → Runtime,
build… → Runtime service account**, or via `gcloud functions deploy … 
--service-account`). This is optional hardening — there is still no downloaded
key; the function authenticates via Application Default Credentials either way.

## 8. Install, build shared, prebuild, and run a dev build on device

A custom **dev client** is required — Plaid Link, Google Sign-In, and push
notifications do not work in Expo Go.

```bash
npm install
npm run build:shared

# From the app workspace:
npx expo install --fix     # reconcile version pins to your Expo SDK
npx expo prebuild --clean  # generates native ios/ and android/ projects
```

Then run on a connected device or simulator:

```bash
npm --workspace app run ios       # or open app/ios in Xcode
npm --workspace app run android   # or open app/android in Android Studio
```

If you plan to use EAS cloud builds instead of local `run:ios`/`run:android`,
run `eas init` (from `app/`) once to create the EAS project, copy the resulting
project id into `EXPO_PUBLIC_EAS_PROJECT_ID`, and build with the profiles in
`app/eas.json`:

```bash
eas build --profile development --platform ios    # or preview / production
```

> Version notes: the `@google/genai` dependency is pinned to `^2.0.0`; if that
> exact range is unavailable, install the latest published version and adjust.
> Any Expo/native version pins should be reconciled with `npx expo install --fix`
> rather than hand-editing `package.json`.

## 9. Trigger / verify the nightly pipeline

- **Automatically:** the `nightlyPipeline` scheduled function runs daily at
  **08:17 UTC** (`schedule: '17 8 * * *'`), provisioned as a Cloud Scheduler job
  when you deploy the Functions. Cloud Scheduler is punctual and reliable, so no
  keepalive workflow is needed.
- **Manually (force a run now):** in the
  [Cloud Scheduler console](https://console.cloud.google.com/cloudscheduler),
  find the `firebase-schedule-nightlyPipeline-<region>` job and click **Force
  run**, or from the CLI:

  ```bash
  gcloud scheduler jobs run firebase-schedule-nightlyPipeline-us-central1 --location=us-central1
  ```

- **Locally (against your real data, without deploying):**

  ```bash
  npm run pipeline:local          # or: cd functions && npx tsx src/pipeline/local.ts
  ```

  A local run needs Firestore credentials plus the Plaid/Gemini env. Either run
  `gcloud auth application-default login` (ADC), **or** set
  `FIREBASE_SERVICE_ACCOUNT_BASE64` to a base64 service-account key; then export
  `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, and `GEMINI_API_KEY` in your
  shell before running.

---

Once step 9 succeeds, open the app, sign in with Google, link a bank via Plaid
Link, and after the next pipeline run (trigger it manually to skip the wait) your
transactions, categories, budgets, and insights will populate.
