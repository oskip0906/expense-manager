/**
 * Client-side stats derivation from a month's transactions. The nightly
 * pipeline computes the authoritative snapshot for AI suggestions; this mirrors
 * that math for instant, offline-capable dashboard/trends rendering.
 *
 * Sign convention (Plaid): amount > 0 = money out (spend); amount < 0 = money in.
 */
import { useMemo } from 'react';
import {
  toDateKey,
  toMonthKey,
  projectMonthEnd,
  type Budget,
  type Category,
  type Transaction,
} from '@expense/shared';
import { useMonthTransactions } from './useTransactions';
import { useBudget, useCategories } from './queries';

export interface CategoryStat {
  categoryId: string;
  categoryName: string;
  color: string;
  total: number; // spend
  budget: number | null;
  consumedPct: number | null;
}

export interface MonthStats {
  month: string;
  monthToDateSpend: number;
  monthToDateIncome: number;
  projectedMonthEndSpend: number;
  totalBudget: number | null;
  perCategory: CategoryStat[];
  topMerchants: Array<{ merchantName: string; total: number; count: number }>;
  /** dateKey -> spend, for sparkline + calendar heatmap. */
  byDay: Record<string, number>;
}

const UNCATEGORIZED = { id: '__uncat__', name: 'Uncategorized', color: '#5D6B84' };

export function computeMonthStats(
  txns: Transaction[],
  budget: Budget | null,
  categories: Category[],
  now: Date,
  tz: string,
): MonthStats {
  const month = txns[0]?.month ?? toMonthKey(now, tz);
  const catById = new Map(categories.map((c) => [c.categoryId, c]));

  let monthToDateSpend = 0;
  let monthToDateIncome = 0;
  const perCat = new Map<string, { total: number; name: string; color: string }>();
  const merchants = new Map<string, { total: number; count: number }>();
  const byDay: Record<string, number> = {};

  for (const t of txns) {
    const spend = t.amount > 0 ? t.amount : 0;
    if (t.amount > 0) monthToDateSpend += t.amount;
    else monthToDateIncome += -t.amount;

    if (spend > 0) {
      const catId = t.categoryId ?? UNCATEGORIZED.id;
      const cat = catId === UNCATEGORIZED.id ? undefined : catById.get(catId);
      const entry = perCat.get(catId) ?? {
        total: 0,
        name: cat?.name ?? t.categoryName ?? UNCATEGORIZED.name,
        color: cat?.color ?? UNCATEGORIZED.color,
      };
      entry.total += spend;
      perCat.set(catId, entry);

      const mName = t.merchantName ?? t.name;
      const m = merchants.get(mName) ?? { total: 0, count: 0 };
      m.total += spend;
      m.count += 1;
      merchants.set(mName, m);

      const dk = toDateKey(t.date.toDate(), tz);
      byDay[dk] = (byDay[dk] ?? 0) + spend;
    }
  }

  const perCategory: CategoryStat[] = [...perCat.entries()]
    .map(([categoryId, v]) => {
      const cap = budget?.perCategory?.[categoryId] ?? null;
      return {
        categoryId,
        categoryName: v.name,
        color: v.color,
        total: v.total,
        budget: cap,
        consumedPct: cap && cap > 0 ? v.total / cap : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  const topMerchants = [...merchants.entries()]
    .map(([merchantName, v]) => ({ merchantName, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const isCurrentMonth = month === toMonthKey(now, tz);
  const projectedMonthEndSpend = isCurrentMonth
    ? projectMonthEnd(monthToDateSpend, now, tz)
    : monthToDateSpend;

  return {
    month,
    monthToDateSpend,
    monthToDateIncome,
    projectedMonthEndSpend,
    totalBudget: budget?.totalCap ?? null,
    perCategory,
    topMerchants,
    byDay,
  };
}

export function useMonthStats(month: string) {
  const txnsQ = useMonthTransactions(month);
  const budgetQ = useBudget(month);
  const catsQ = useCategories();

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

  const stats = useMemo<MonthStats | undefined>(() => {
    if (!txnsQ.data || !catsQ.data) return undefined;
    return computeMonthStats(txnsQ.data, budgetQ.data ?? null, catsQ.data, new Date(), tz);
  }, [txnsQ.data, budgetQ.data, catsQ.data, tz]);

  return {
    data: stats,
    isLoading: txnsQ.isLoading || catsQ.isLoading || budgetQ.isLoading,
    isRefetching: txnsQ.isRefetching || catsQ.isRefetching || budgetQ.isRefetching,
    isError: txnsQ.isError || catsQ.isError,
    // Refetch all three sources so freshly-saved budgets refresh the rings/math.
    refetch: async () => {
      await Promise.all([txnsQ.refetch(), budgetQ.refetch(), catsQ.refetch()]);
    },
  };
}
