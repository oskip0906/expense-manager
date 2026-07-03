/**
 * Read hooks + category/budget mutations built on TanStack Query over Firestore.
 * All reads are scoped to the signed-in user. Mutations invalidate the relevant
 * query keys so the UI stays consistent.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  paths,
  type Account,
  type Budget,
  type BudgetEdit,
  type Category,
  type Insight,
  type PlaidItem,
  type SyncState,
  type UserProfile,
} from '@expense/shared';
import { db } from '@/lib/firebase';
import { useUid } from '@/lib/auth';
import { converters } from '@/lib/converters';
import { qk } from '@/lib/queryKeys';

// --- Reads --------------------------------------------------------------

export function useProfile() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.profile(uid),
    queryFn: async (): Promise<UserProfile | null> => {
      const snap = await getDoc(
        doc(db, paths.user(uid)).withConverter(converters.profile),
      );
      return snap.exists() ? snap.data() : null;
    },
  });
}

export function useAccounts() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.accounts(uid),
    queryFn: async (): Promise<Account[]> => {
      const snap = await getDocs(
        collection(db, paths.accounts(uid)).withConverter(converters.account),
      );
      return snap.docs.map((d) => d.data());
    },
  });
}

export function usePlaidItems() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.plaidItems(uid),
    queryFn: async (): Promise<PlaidItem[]> => {
      const snap = await getDocs(
        collection(db, paths.plaidItems(uid)).withConverter(converters.plaidItem),
      );
      return snap.docs.map((d) => d.data());
    },
  });
}

export function useCategories() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.categories(uid),
    queryFn: async (): Promise<Category[]> => {
      const snap = await getDocs(
        query(
          collection(db, paths.categories(uid)).withConverter(converters.category),
          orderBy('name'),
        ),
      );
      return snap.docs.map((d) => d.data());
    },
  });
}

export function useBudget(month: string) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.budgets(uid, month),
    queryFn: async (): Promise<Budget | null> => {
      const snap = await getDoc(
        doc(db, paths.budget(uid, month)).withConverter(converters.budget),
      );
      return snap.exists() ? snap.data() : null;
    },
  });
}

export function useInsights() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.insights(uid),
    queryFn: async (): Promise<Insight[]> => {
      const snap = await getDocs(
        query(
          collection(db, paths.insights(uid)).withConverter(converters.insight),
          orderBy('date', 'desc'),
        ),
      );
      return snap.docs.map((d) => d.data());
    },
  });
}

export function useSyncState() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.syncState(uid),
    queryFn: async (): Promise<SyncState | null> => {
      const snap = await getDoc(doc(db, paths.syncState(uid)));
      return snap.exists() ? (snap.data() as SyncState) : null;
    },
  });
}

// --- Category mutations -------------------------------------------------

export function useCreateCategory() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color: string; icon: string; description?: string }) => {
      const ref = await addDoc(
        collection(db, paths.categories(uid)).withConverter(converters.category),
        {
          name: input.name,
          description: input.description ?? null,
          color: input.color,
          icon: input.icon,
          isArchived: false,
          createdBy: 'user',
          createdAt: serverTimestamp() as never,
          updatedAt: serverTimestamp() as never,
        } as never,
      );
      return ref.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories(uid) }),
  });
}

export function useUpdateCategory() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      categoryId: string;
      patch: Partial<Pick<Category, 'name' | 'color' | 'icon' | 'description' | 'isArchived'>>;
    }) => {
      await updateDoc(doc(db, paths.category(uid, input.categoryId)), {
        ...input.patch,
        updatedAt: serverTimestamp(),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories(uid) }),
  });
}

export function useArchiveCategory() {
  const update = useUpdateCategory();
  return (categoryId: string) =>
    update.mutateAsync({ categoryId, patch: { isArchived: true } });
}

/**
 * Reassign every transaction from `sourceId` to `targetId`, then archive the
 * source. Batched in chunks of 400 (Firestore limit is 500 writes/batch).
 */
export function useMergeCategories() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sourceId: string; targetId: string; targetName: string }) => {
      const snap = await getDocs(
        query(
          collection(db, paths.transactions(uid)),
          where('categoryId', '==', input.sourceId),
        ),
      );
      const chunks: (typeof snap.docs)[] = [];
      for (let i = 0; i < snap.docs.length; i += 400) {
        chunks.push(snap.docs.slice(i, i + 400));
      }
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        for (const d of chunk) {
          batch.update(d.ref, {
            categoryId: input.targetId,
            categoryName: input.targetName,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      await updateDoc(doc(db, paths.category(uid, input.sourceId)), {
        isArchived: true,
        updatedAt: serverTimestamp(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.categories(uid) });
      qc.invalidateQueries({ queryKey: ['transactions', uid] });
    },
  });
}

// --- Budget mutation ----------------------------------------------------

export function useSetBudget(month: string) {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (edit: BudgetEdit) => {
      await setDoc(
        doc(db, paths.budget(uid, month)),
        {
          month,
          perCategory: edit.perCategory,
          totalCap: edit.totalCap ?? deleteField(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.budgets(uid, month) }),
  });
}
