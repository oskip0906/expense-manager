/**
 * Classify newly-synced, unclassified transactions with Gemini.
 *
 * Selection: transactions with categoryId == null AND not manually locked.
 * We NEVER read or write transactions whose manualCategoryLock is true.
 *
 * For NEW_CATEGORY_SENTINEL results we dedupe near-identical proposed names
 * (case-insensitive, trimmed) so one run doesn't create three "Coffee Shops"
 * variants, create the categories once (createdBy:'ai', palette color cycled,
 * icon 'pricetag'), then map txns onto the resulting categoryId/name.
 */
import {
  CATEGORY_PALETTE,
  NEW_CATEGORY_SENTINEL,
  classificationNeedsNewCategory,
  paths,
  type Category,
} from '@expense/shared';
import { db, FieldValue } from '../admin';
import { classifyTransactions, type ClassifyInput } from './gemini';

const MAX_BATCH_OPS = 400;

export interface ClassifyCounts {
  classified: number;
  newCategories: number;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function classifyNew(uid: string, _userTz: string): Promise<ClassifyCounts> {
  // --- Load unclassified, unlocked transactions.
  // Firestore can't express "!= true" cheaply alongside another equality, and
  // manualCategoryLock is always a concrete boolean on our docs, so we filter
  // categoryId==null server-side and drop locked docs client-side.
  const snap = await db
    .collection(paths.transactions(uid))
    .where('categoryId', '==', null)
    .get();

  const docs = snap.docs.filter((d) => d.get('manualCategoryLock') !== true);
  if (docs.length === 0) return { classified: 0, newCategories: 0 };

  const inputs: ClassifyInput[] = docs.map((d) => ({
    txnId: d.id,
    name: (d.get('name') as string) ?? '',
    merchantName: (d.get('merchantName') as string | null) ?? null,
    amount: (d.get('amount') as number) ?? 0,
  }));

  // --- Load existing (non-archived) categories to offer for reuse.
  const catSnap = await db.collection(paths.categories(uid)).get();
  const categories: Category[] = catSnap.docs
    .map((d) => d.data() as Category)
    .filter((c) => !c.isArchived);

  // Map normalized name -> the id/name we'll stamp onto transactions. Includes
  // both existing categories and any we create below.
  const byName = new Map<string, { categoryId: string; name: string }>();
  for (const c of categories) byName.set(normalizeName(c.name), { categoryId: c.categoryId, name: c.name });

  // --- Ask Gemini.
  const result = await classifyTransactions(
    categories.map((c) => ({ name: c.name, description: c.description })),
    inputs,
  );
  const resultByTxn = new Map(result.items.map((i) => [i.txnId, i]));

  // --- First pass: collect the distinct NEW category proposals (deduped).
  const proposals = new Map<string, { name: string; description: string | null }>();
  for (const item of result.items) {
    if (!classificationNeedsNewCategory(item)) continue;
    const proposed = item.newCategory;
    if (!proposed?.name) continue;
    const key = normalizeName(proposed.name);
    // Skip if it collides with an existing category (reuse it instead).
    if (byName.has(key)) continue;
    if (!proposals.has(key)) {
      proposals.set(key, {
        name: proposed.name.trim(),
        description: proposed.description?.trim() || null,
      });
    }
  }

  // --- Create the new categories (one write each). Cycle the palette by the
  // current total category count so colors stay varied across runs.
  const now = FieldValue.serverTimestamp();
  let paletteIdx = categories.length;
  let newCategories = 0;
  for (const [key, prop] of proposals) {
    const ref = db.collection(paths.categories(uid)).doc();
    const color = CATEGORY_PALETTE[paletteIdx % CATEGORY_PALETTE.length]!;
    paletteIdx += 1;
    await ref.set({
      categoryId: ref.id,
      name: prop.name,
      description: prop.description,
      color,
      icon: 'pricetag',
      isArchived: false,
      createdBy: 'ai',
      createdAt: now,
      updatedAt: now,
    });
    byName.set(key, { categoryId: ref.id, name: prop.name });
    newCategories += 1;
  }

  // --- Second pass: write categoryId/categoryName onto each txn (batched).
  let batch = db.batch();
  let ops = 0;
  let classified = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const doc of docs) {
    const item = resultByTxn.get(doc.id);
    if (!item) continue;

    let target: { categoryId: string; name: string } | undefined;
    if (classificationNeedsNewCategory(item)) {
      const key = item.newCategory?.name ? normalizeName(item.newCategory.name) : '';
      target = key ? byName.get(key) : undefined;
    } else if (item.categoryName !== NEW_CATEGORY_SENTINEL) {
      target = byName.get(normalizeName(item.categoryName));
    }
    if (!target) continue; // Unmapped name — leave unclassified for next run.

    // Guard again: never overwrite a locked txn (state may have changed).
    if (doc.get('manualCategoryLock') === true) continue;

    batch.set(
      doc.ref,
      { categoryId: target.categoryId, categoryName: target.name, updatedAt: now },
      { merge: true },
    );
    ops += 1;
    classified += 1;
    if (ops >= MAX_BATCH_OPS) await flush();
  }
  await flush();

  return { classified, newCategories };
}
