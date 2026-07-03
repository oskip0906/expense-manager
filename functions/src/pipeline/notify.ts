/**
 * Persist the day's insight and (optionally) push it to the user's devices.
 *
 * Flow:
 *  1. Write insights/{dateKey} { tips, stats, delivered:false, createdAt }.
 *  2. Before sending, reconcile any push RECEIPTS from the PREVIOUS run's
 *     tickets (stored on syncState/state.pushTickets): fetch receipts and drop
 *     any pushToken whose receipt error is DeviceNotRegistered. Then clear the
 *     stored tickets.
 *  3. If there are tips AND the profile opted into push, send Expo pushes to all
 *     registered tokens, store the returned ticket ids for next-run reconciliation,
 *     and flip delivered:true.
 *
 * Everything is wrapped in try/catch so a push failure never fails the run —
 * the insight document is always written.
 */
import Expo, {
  type ExpoPushMessage,
  type ExpoPushReceiptId,
  type ExpoPushTicket,
} from 'expo-server-sdk';
import {
  paths,
  type InsightTip,
  type StatsSnapshot,
  type UserProfile,
} from '@expense/shared';
import { db, FieldValue } from '../admin';

const expo = new Expo();

interface StoredTicket {
  receiptId: ExpoPushReceiptId;
  tokenId: string;
  expoToken: string;
}

/**
 * Reconcile receipts from the previous run: delete tokens reported as
 * DeviceNotRegistered so we stop pushing to dead devices. Best-effort.
 */
async function reconcileReceipts(uid: string): Promise<void> {
  const stateRef = db.doc(paths.syncState(uid));
  const stateSnap = await stateRef.get();
  const stored = (stateSnap.get('pushTickets') as StoredTicket[] | undefined) ?? [];
  if (stored.length === 0) return;

  const byReceiptId = new Map<string, StoredTicket>();
  for (const s of stored) byReceiptId.set(s.receiptId, s);

  const receiptIdChunks = expo.chunkPushNotificationReceiptIds([...byReceiptId.keys()]);
  for (const idChunk of receiptIdChunks) {
    const receipts = await expo.getPushNotificationReceiptsAsync(idChunk);
    for (const [receiptId, receipt] of Object.entries(receipts)) {
      if (receipt.status === 'error') {
        const detail = receipt.details?.error;
        if (detail === 'DeviceNotRegistered') {
          const t = byReceiptId.get(receiptId);
          if (t) {
            await db
              .doc(paths.pushToken(uid, t.tokenId))
              .delete()
              .catch(() => undefined);
            console.log(`[notify] ${uid}: pruned DeviceNotRegistered token ${t.tokenId}`);
          }
        }
      }
    }
  }

  // Clear the stored tickets — they've been reconciled.
  await stateRef.set({ pushTickets: FieldValue.delete() }, { merge: true });
}

export async function writeAndNotify(
  uid: string,
  dateKey: string,
  tips: InsightTip[],
  stats: StatsSnapshot,
  profile: UserProfile,
): Promise<void> {
  // 1. Always write the insight document first.
  const insightRef = db.doc(paths.insight(uid, dateKey));
  await insightRef.set({
    date: dateKey,
    tips,
    stats,
    delivered: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  // 2. Reconcile previous run's receipts (best-effort, isolated).
  try {
    await reconcileReceipts(uid);
  } catch (err) {
    console.warn(`[notify] ${uid}: receipt reconciliation failed:`, err);
  }

  // 3. Send pushes only when there's something to say and the user opted in.
  const wantsPush = profile.settings?.notifChannels?.push === true;
  if (tips.length === 0 || !wantsPush) return;

  try {
    const tokensSnap = await db.collection(paths.pushTokens(uid)).get();
    const tokenDocs = tokensSnap.docs
      .map((d) => ({ tokenId: d.id, expoToken: d.get('expoToken') as string }))
      .filter((t) => typeof t.expoToken === 'string' && Expo.isExpoPushToken(t.expoToken));

    if (tokenDocs.length === 0) return;

    const lead = tips[0]!;
    const messages: ExpoPushMessage[] = tokenDocs.map((t) => ({
      to: t.expoToken,
      sound: 'default',
      title: lead.title,
      body: lead.body,
      data: { dateKey, tipCount: tips.length },
    }));

    // Map each message index back to the token that produced it.
    const chunks = expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];
    // chunkPushNotifications preserves order, so we can zip tickets back to tokens.
    for (const chunk of chunks) {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    }

    // Store successful receipt ids (with their token) for next-run reconciliation.
    const stored: StoredTicket[] = [];
    tickets.forEach((ticket, i) => {
      const token = tokenDocs[i];
      if (!token) return;
      if (ticket.status === 'ok') {
        stored.push({ receiptId: ticket.id, tokenId: token.tokenId, expoToken: token.expoToken });
      } else if (ticket.status === 'error') {
        // Immediate rejection (e.g. bad token) — prune right away.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          void db
            .doc(paths.pushToken(uid, token.tokenId))
            .delete()
            .catch(() => undefined);
        }
        console.warn(`[notify] ${uid}: push ticket error for ${token.tokenId}:`, ticket.message);
      }
    });

    if (stored.length > 0) {
      await db.doc(paths.syncState(uid)).set({ pushTickets: stored }, { merge: true });
    }

    await insightRef.set({ delivered: true }, { merge: true });
  } catch (err) {
    console.warn(`[notify] ${uid}: push send failed (insight still written):`, err);
  }
}
