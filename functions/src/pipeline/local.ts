/**
 * Local runner for the nightly pipeline — for manual testing without deploying.
 *
 *   cd functions
 *   FIREBASE_SERVICE_ACCOUNT_BASE64=... PLAID_CLIENT_ID=... PLAID_SECRET=... \
 *   PLAID_ENV=sandbox GEMINI_API_KEY=... npx tsx src/pipeline/local.ts
 *
 * (Or `gcloud auth application-default login` instead of the base64 key.)
 * In production this same logic runs as the `nightlyPipeline` scheduled function.
 */
import { runPipeline } from './run';

runPipeline()
  .then(() => {
    console.log('[pipeline] local run complete');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
