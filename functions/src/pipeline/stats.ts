/**
 * Compute a StatsSnapshot for a user's given month.
 *
 * Money sign convention (Plaid): amount > 0 = spend (money out), amount < 0 =
 * income (money in). All "spend" figures below sum positive amounts only.
 *
 * Derived figures:
 *  - monthToDateSpend: sum of positive amounts this month up to "today".
 *  - lastMonthSameDaySpend: same, for last month, up to the SAME day-of-month
 *    (so MoM compares like-for-like partial months).
 *  - momDeltaPct: (mtd - lastSameDay) / lastSameDay, null if last is 0.
 *  - perCategory: spend total per category, budget cap, consumedPct, and a
 *    wowDeltaPct = (this-7-day-window vs previous-7-day-window) / previous.
 *  - topMerchants: by spend total, top 8.
 *  - projectedMonthEndSpend: linear pace projection.
 */
import {
  dayOfMonth,
  paths,
  projectMonthEnd,
  toMonthKey,
  type Budget,
  type Category,
  type StatsSnapshot,
  type Transaction,
} from '@expense/shared';
import { db } from '../admin';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Sum positive (spend) amounts; ignores income/refunds (negative). */
function spendOf(amount: number): number {
  return amount > 0 ? amount : 0;
}

function pct(current: number, base: number): number | null {
  if (base <= 0) return null;
  return (current - base) / base;
}

export async function computeStats(
  uid: string,
  month: string,
  userTz: string,
  now: Date = new Date(),
): Promise<StatsSnapshot> {
  const [yStr, mStr] = month.split('-');
  const year = Number(yStr);
  const monthNum = Number(mStr); // 1-based
  const lastMonthDate = new Date(Date.UTC(year, monthNum - 2, 15, 12));
  const lastMonthKey = toMonthKey(lastMonthDate, userTz);

  // Day-of-month boundary for like-for-like MoM (partial month comparison).
  const today = dayOfMonth(now, userTz);

  // --- Load this month + last month transactions (cheap single-equality query).
  const [thisSnap, lastSnap, catSnap, budgetSnap] = await Promise.all([
    db.collection(paths.transactions(uid)).where('month', '==', month).get(),
    db.collection(paths.transactions(uid)).where('month', '==', lastMonthKey).get(),
    db.collection(paths.categories(uid)).get(),
    db.doc(paths.budget(uid, month)).get(),
  ]);

  const thisTxns = thisSnap.docs.map((d) => d.data() as Transaction);
  const lastTxns = lastSnap.docs.map((d) => d.data() as Transaction);

  const categoriesById = new Map<string, Category>();
  for (const d of catSnap.docs) {
    const c = d.data() as Category;
    categoriesById.set(c.categoryId, c);
  }

  const budget = budgetSnap.exists ? (budgetSnap.data() as Budget) : null;
  const perCategoryCaps = budget?.perCategory ?? {};

  // --- Month-to-date spend (up to today's day-of-month, inclusive).
  const monthToDateSpend = thisTxns.reduce((sum, t) => {
    const dom = dayOfMonth(t.date.toDate(), userTz);
    return dom <= today ? sum + spendOf(t.amount) : sum;
  }, 0);

  const lastMonthSameDaySpend = lastTxns.reduce((sum, t) => {
    const dom = dayOfMonth(t.date.toDate(), userTz);
    return dom <= today ? sum + spendOf(t.amount) : sum;
  }, 0);

  const momDeltaPct = pct(monthToDateSpend, lastMonthSameDaySpend);

  // --- Per-category spend totals (full month-to-date, all synced txns in month).
  interface Agg {
    categoryId: string;
    categoryName: string;
    total: number;
    thisWeek: number;
    prevWeek: number;
  }
  const nowMs = now.getTime();
  const weekAgoMs = nowMs - 7 * MS_PER_DAY;
  const twoWeeksAgoMs = nowMs - 14 * MS_PER_DAY;

  const aggs = new Map<string, Agg>();
  const uncategorizedKey = '__uncategorized__';

  const ensureAgg = (id: string, name: string): Agg => {
    let a = aggs.get(id);
    if (!a) {
      a = { categoryId: id, categoryName: name, total: 0, thisWeek: 0, prevWeek: 0 };
      aggs.set(id, a);
    }
    return a;
  };
  const bucketWindow = (a: Agg, ms: number, spend: number) => {
    if (ms >= weekAgoMs) a.thisWeek += spend;
    else if (ms >= twoWeeksAgoMs) a.prevWeek += spend;
  };

  for (const t of thisTxns) {
    const spend = spendOf(t.amount);
    if (spend === 0) continue;
    const id = t.categoryId ?? uncategorizedKey;
    const name = t.categoryName ?? categoriesById.get(id)?.name ?? 'Uncategorized';
    const a = ensureAgg(id, name);
    a.total += spend;
    bucketWindow(a, t.date.toDate().getTime(), spend);
  }

  // Fold in LAST month's transactions for the trailing 7/14-day WoW windows only
  // — early in a month the "previous week" spills into the prior month. Their
  // spend is intentionally excluded from `total` (a current-month figure).
  for (const t of lastTxns) {
    const spend = spendOf(t.amount);
    if (spend === 0) continue;
    const ms = t.date.toDate().getTime();
    if (ms < twoWeeksAgoMs) continue;
    const id = t.categoryId ?? uncategorizedKey;
    const name = t.categoryName ?? categoriesById.get(id)?.name ?? 'Uncategorized';
    bucketWindow(ensureAgg(id, name), ms, spend);
  }

  const perCategory = [...aggs.values()]
    .filter((a) => a.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((a) => {
      const cap = perCategoryCaps[a.categoryId] ?? null;
      return {
        categoryId: a.categoryId,
        categoryName: a.categoryName,
        total: a.total,
        budget: cap,
        consumedPct: cap && cap > 0 ? a.total / cap : null,
        wowDeltaPct: pct(a.thisWeek, a.prevWeek),
      };
    });

  // --- Top merchants by spend.
  const merchantAgg = new Map<string, { total: number; count: number }>();
  for (const t of thisTxns) {
    const spend = spendOf(t.amount);
    if (spend === 0) continue;
    const key = t.merchantName ?? t.name;
    if (!key) continue;
    const m = merchantAgg.get(key) ?? { total: 0, count: 0 };
    m.total += spend;
    m.count += 1;
    merchantAgg.set(key, m);
  }
  const topMerchants = [...merchantAgg.entries()]
    .map(([merchantName, v]) => ({ merchantName, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // --- Projection (only meaningful for the current month; harmless otherwise).
  const isCurrentMonth = month === toMonthKey(now, userTz);
  const projectedMonthEndSpend = isCurrentMonth
    ? projectMonthEnd(monthToDateSpend, now, userTz)
    : monthToDateSpend;

  return {
    month,
    monthToDateSpend,
    lastMonthSameDaySpend,
    momDeltaPct,
    perCategory,
    topMerchants,
    projectedMonthEndSpend,
  };
}
