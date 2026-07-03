/**
 * Single firebase-admin app shared by the callable functions and the scheduled
 * nightly pipeline. Admin access bypasses security rules — this is the only
 * runtime allowed to read users/{uid}/_private/plaid.
 *
 * Credentials:
 *  - In the deployed Cloud Function, no env is set → initializeApp() uses the
 *    function's runtime service account via Application Default Credentials.
 *  - For local runs (tsx), set FIREBASE_SERVICE_ACCOUNT_BASE64 to a base64 key,
 *    or run `gcloud auth application-default login` and leave it unset (ADC).
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    initializeApp({ credential: cert(json) });
  } else {
    initializeApp();
  }
}

export const db = getFirestore();
export { FieldValue, Timestamp };
