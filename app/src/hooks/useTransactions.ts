/**
 * Transaction hooks.
 *   - useMonthTransactions(month): all of a month's txns (charts/stats source).
 *   - useTransactionsFeed(filters): paginated date-desc feed. Firestore applies
 *     the date range + ONE equality filter (matching our composite indexes);
 *     free-text search + any secondary filters are applied client-side via
 *     applyClientFilters (per design: filter the loaded range over nameLower).
 *   - mutations: edit annotations, add a manual txn, delete a manual txn.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  paths,
  parsePlaidDate,
  type ManualTransactionInput,
  type Transaction,
  type TransactionEdit,
} from '@expense/shared';
import { db } from '@/lib/firebase';
import { useUid } from '@/lib/auth';
import { converters } from '@/lib/converters';
import { qk } from '@/lib/queryKeys';

const PAGE_SIZE = 40;

export interface TxnFilters {
  start?: Date;
  end?: Date;
  categoryId?: string;
  accountId?: string;
  pending?: boolean;
  search?: string;
}

export function useMonthTransactions(month: string) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.transactionsByMonth(uid, month),
    queryFn: async (): Promise<Transaction[]> => {
      const snap = await getDocs(
        query(
          collection(db, paths.transactions(uid)).withConverter(converters.transaction),
          where('month', '==', month),
        ),
      );
      return snap.docs.map((d) => d.data());
    },
  });
}

interface FeedPage {
  items: Transaction[];
  cursor: QueryDocumentSnapshot | null;
}

export function useTransactionsFeed(filters: TxnFilters, options?: { enabled?: boolean }) {
  const uid = useUid();
  return useInfiniteQuery({
    queryKey: [...qk.transactionsFeed(uid), serializeFilters(filters)],
    // Callers can gate the query (e.g. the category drill-down only runs once a
    // category is selected) so it doesn't paginate the whole history in the bg.
    enabled: options?.enabled ?? true,
    initialPageParam: null as QueryDocumentSnapshot | null,
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const constraints: QueryConstraint[] = [orderBy('date', 'desc')];
      if (filters.start) constraints.push(where('date', '>=', Timestamp.fromDate(filters.start)));
      if (filters.end) constraints.push(where('date', '<=', Timestamp.fromDate(filters.end)));
      // At most one equality filter server-side (index coverage); priority order.
      if (filters.categoryId) constraints.push(where('categoryId', '==', filters.categoryId));
      else if (filters.accountId) constraints.push(where('accountId', '==', filters.accountId));
      else if (filters.pending !== undefined) constraints.push(where('pending', '==', filters.pending));
      if (pageParam) constraints.push(startAfter(pageParam));
      constraints.push(limit(PAGE_SIZE));

      const snap = await getDocs(
        query(collection(db, paths.transactions(uid)).withConverter(converters.transaction), ...constraints),
      );
      return {
        items: snap.docs.map((d) => d.data()),
        cursor: snap.docs.length === PAGE_SIZE ? snap.docs[snap.docs.length - 1]! : null,
      };
    },
    getNextPageParam: (last) => last.cursor,
  });
}

/** Apply free-text search + secondary filters not enforced server-side. */
export function applyClientFilters(txns: Transaction[], filters: TxnFilters): Transaction[] {
  const q = filters.search?.trim().toLowerCase();
  return txns.filter((t) => {
    if (q && !t.nameLower.includes(q)) return false;
    // Secondary equality filters (whichever wasn't applied server-side).
    if (filters.categoryId && filters.accountId && t.accountId !== filters.accountId) return false;
    if (
      (filters.categoryId || filters.accountId) &&
      filters.pending !== undefined &&
      t.pending !== filters.pending
    ) {
      return false;
    }
    return true;
  });
}

function serializeFilters(f: TxnFilters): string {
  return JSON.stringify({
    s: f.start?.getTime() ?? null,
    e: f.end?.getTime() ?? null,
    c: f.categoryId ?? null,
    a: f.accountId ?? null,
    p: f.pending ?? null,
  });
}

// --- Mutations ----------------------------------------------------------

export function useUpdateTransaction() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { txnId: string; edit: TransactionEdit }) => {
      await updateDoc(doc(db, paths.transaction(uid, input.txnId)), {
        ...input.edit,
        updatedAt: serverTimestamp(),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', uid] }),
  });
}

export function useAddManualTransaction() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ManualTransactionInput) => {
      const date = parsePlaidDate(input.date);
      const name = input.name.trim();
      const ref = await addDoc(collection(db, paths.transactions(uid)), {
        accountId: input.accountId,
        itemId: 'manual',
        date: Timestamp.fromDate(date),
        month: input.date.slice(0, 7),
        amount: input.amount,
        isoCurrencyCode: null,
        name,
        merchantName: null,
        nameLower: name.toLowerCase(),
        categoryId: input.categoryId ?? null,
        categoryName: input.categoryName ?? null,
        pending: false,
        manualCategoryLock: input.categoryId != null,
        notes: input.notes ?? null,
        isManual: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return ref.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', uid] }),
  });
}

export function useDeleteTransaction() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (txnId: string) => {
      await deleteDoc(doc(db, paths.transaction(uid, txnId)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', uid] }),
  });
}
