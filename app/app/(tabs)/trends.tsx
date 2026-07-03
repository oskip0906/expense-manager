/**
 * Trends — a scrollable dashboard of spending analytics over the last 6 months.
 *
 * Data model note (Rules of Hooks): we need one month's transactions per chart
 * window. Because hooks must be called unconditionally and in a stable order, we
 * compute the six most-recent month keys ONCE and call `useMonthTransactions`
 * exactly six times explicitly — never in a variable-length loop.
 *
 * Sign convention (Plaid): amount > 0 = spend (money out); amount < 0 = income.
 * Spend series therefore sum positive amounts only.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { toDateKey, toMonthKey, type Transaction } from '@expense/shared';
import {
  useMonthTransactions,
  useCategories,
  useBudget,
  useMonthStats,
} from '@/hooks';
import {
  Card,
  EmptyState,
  LoadingState,
  Money,
  Screen,
  SectionHeader,
  ThemedText,
} from '@/components/ui';
import {
  BurnVsBudgetChart,
  CalendarHeatmap,
  CategoryStackedBar,
  PeriodGroupedBar,
  SpendLineArea,
  type CategoryStackedBarSeries,
} from '@/components/charts';
import { theme, fallbackCategoryColor } from '@/theme';

const MONTHS_BACK = 6;
const TOP_CATEGORIES = 5;
type Granularity = 'day' | 'week' | 'month';

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function useTz(): string {
  return useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
    [],
  );
}

/**
 * The six most-recent month keys, oldest→newest, e.g. for July 2026:
 * ['2026-02', ..., '2026-07']. Computed once per mount from `now`.
 */
function useLastSixMonthKeys(tz: string): string[] {
  return useMemo(() => {
    const now = new Date();
    const keys: string[] = [];
    for (let i = MONTHS_BACK - 1; i >= 0; i--) {
      // Anchor to the 1st of each month in UTC, then format in the user's tz.
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1, 12));
      keys.push(toMonthKey(d, tz));
    }
    return keys;
  }, [tz]);
}

export default function TrendsScreen() {
  const tz = useTz();
  const monthKeys = useLastSixMonthKeys(tz);
  const currentMonth = monthKeys[monthKeys.length - 1]!;

  // --- Hooks: called unconditionally, in a fixed order ---------------------
  // Six explicit calls (NOT a loop) so the hook count is statically known.
  const m0 = useMonthTransactions(monthKeys[0]!);
  const m1 = useMonthTransactions(monthKeys[1]!);
  const m2 = useMonthTransactions(monthKeys[2]!);
  const m3 = useMonthTransactions(monthKeys[3]!);
  const m4 = useMonthTransactions(monthKeys[4]!);
  const m5 = useMonthTransactions(monthKeys[5]!);
  const monthQueries = [m0, m1, m2, m3, m4, m5];

  const categoriesQ = useCategories();
  const budgetQ = useBudget(currentMonth);
  const statsQ = useMonthStats(currentMonth);

  const [granularity, setGranularity] = useState<Granularity>('week');

  // --- Loading / error state -----------------------------------------------
  const anyLoading =
    monthQueries.some((q) => q.isLoading) || categoriesQ.isLoading;
  const anyError = monthQueries.some((q) => q.isError) || categoriesQ.isError;

  const refetchAll = () => {
    monthQueries.forEach((q) => q.refetch());
    categoriesQ.refetch();
    budgetQ.refetch();
    statsQ.refetch();
  };

  // --- Derived data (memoized on resolved query data) ----------------------
  const txnsByMonth = useMemo<Transaction[][]>(
    () => [
      m0.data ?? [],
      m1.data ?? [],
      m2.data ?? [],
      m3.data ?? [],
      m4.data ?? [],
      m5.data ?? [],
    ],
    [m0.data, m1.data, m2.data, m3.data, m4.data, m5.data],
  );

  const totalTxns = useMemo(
    () => txnsByMonth.reduce((sum, arr) => sum + arr.length, 0),
    [txnsByMonth],
  );

  // Line/area: spend over time, bucketed by the selected granularity.
  const linePoints = useMemo(
    () => buildLinePoints(txnsByMonth, monthKeys, granularity, tz),
    [txnsByMonth, monthKeys, granularity, tz],
  );

  // Determine the top spending categories across the whole 6-month window.
  const topCategoryIds = useMemo(
    () => rankTopCategories(txnsByMonth, TOP_CATEGORIES),
    [txnsByMonth],
  );

  // Stacked bar: per-month composition across the top categories.
  const stackedSeries = useMemo<CategoryStackedBarSeries[]>(
    () => buildStackedSeries(txnsByMonth, topCategoryIds, categoriesQ.data ?? []),
    [txnsByMonth, topCategoryIds, categoriesQ.data],
  );

  // Grouped bar: this month vs last month per top category.
  const grouped = useMemo(
    () => buildGrouped(txnsByMonth, topCategoryIds, categoriesQ.data ?? []),
    [txnsByMonth, topCategoryIds, categoriesQ.data],
  );

  // Burn: cumulative spend across the current month's days.
  const burnCumulative = useMemo(
    () => buildBurnCumulative(txnsByMonth[txnsByMonth.length - 1] ?? [], tz),
    [txnsByMonth, tz],
  );

  const totalBudget = budgetQ.data?.totalCap ?? 0;
  const byDay = statsQ.data?.byDay ?? {};
  const windowSpend = useMemo(
    () =>
      txnsByMonth
        .flat()
        .reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), 0),
    [txnsByMonth],
  );

  // --- Render --------------------------------------------------------------
  if (anyLoading) {
    return (
      <Screen>
        <Header />
        <LoadingState />
      </Screen>
    );
  }

  if (anyError) {
    return (
      <Screen scroll refreshing={false} onRefresh={refetchAll}>
        <Header />
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load trends"
          subtitle="Pull to refresh to try again."
        />
      </Screen>
    );
  }

  if (totalTxns === 0) {
    return (
      <Screen scroll refreshing={false} onRefresh={refetchAll}>
        <Header />
        <EmptyState
          icon="bar-chart-outline"
          title="No spending history yet"
          subtitle="Once transactions sync from your linked accounts, your six-month trends will appear here."
        />
      </Screen>
    );
  }

  const rangeLabel = `${shortMonthLabel(monthKeys[0]!)} – ${shortMonthLabel(currentMonth)}`;

  return (
    <Screen scroll refreshing={false} onRefresh={refetchAll}>
      <Header />

      <Card style={{ marginTop: theme.spacing(2) }}>
        <ThemedText variant="label" color={theme.colors.textMuted}>
          {`Total spend · ${rangeLabel}`}
        </ThemedText>
        <View style={{ marginTop: theme.spacing(1) }}>
          <Money amount={windowSpend} variant="title" weight="bold" colorBySign={false} />
        </View>
      </Card>

      {/* Spend over time with a granularity toggle. */}
      <SectionHeader title="Spend over time" />
      <Card>
        <GranularityToggle value={granularity} onChange={setGranularity} />
        <View style={{ marginTop: theme.spacing(3) }}>
          <SpendLineArea points={linePoints} />
        </View>
      </Card>

      {/* Category composition across the six months. */}
      <SectionHeader title="Category mix" />
      <Card>
        <ThemedText variant="label" color={theme.colors.textMuted} style={{ marginBottom: theme.spacing(3) }}>
          {`Top ${TOP_CATEGORIES} categories by spend, month over month`}
        </ThemedText>
        <CategoryStackedBar months={monthKeys} series={stackedSeries} />
      </Card>

      {/* This month vs last month, per top category. */}
      <SectionHeader title="This month vs last" />
      <Card>
        <PeriodGroupedBar
          labels={grouped.labels}
          current={grouped.current}
          previous={grouped.previous}
          currentLabel={shortMonthLabel(currentMonth)}
          previousLabel={
            monthKeys.length >= 2 ? shortMonthLabel(monthKeys[monthKeys.length - 2]!) : 'Previous'
          }
        />
      </Card>

      {/* Cumulative spend vs the total budget for the current month. */}
      <SectionHeader title="Budget burn-down" />
      <Card>
        <BurnVsBudgetChart cumulative={burnCumulative} budget={totalBudget} />
      </Card>

      {/* Daily spend intensity for the current month. */}
      <SectionHeader title={`Daily spend · ${shortMonthLabel(currentMonth)}`} />
      <Card>
        <CalendarHeatmap month={currentMonth} byDay={byDay} />
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Local presentational helpers (kept in-file to avoid name collisions).
// ---------------------------------------------------------------------------

function Header() {
  return (
    <View style={{ marginTop: theme.spacing(2) }}>
      <ThemedText variant="title" weight="bold">
        Trends
      </ThemedText>
      <ThemedText variant="label" color={theme.colors.textMuted} style={{ marginTop: theme.spacing(1) }}>
        Your spending over the last six months
      </ThemedText>
    </View>
  );
}

function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
}) {
  const options: { key: Granularity; label: string }[] = [
    { key: 'day', label: 'Day' },
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
  ];
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.surfaceAlt,
        borderRadius: theme.radius.pill,
        padding: theme.spacing(0.5),
        alignSelf: 'flex-start',
        gap: theme.spacing(0.5),
      }}
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            hitSlop={6}
            style={{
              paddingHorizontal: theme.spacing(3.5),
              paddingVertical: theme.spacing(1.5),
              borderRadius: theme.radius.pill,
              backgroundColor: active ? theme.colors.primary : 'transparent',
            }}
          >
            <ThemedText
              variant="label"
              weight={active ? 'semibold' : 'medium'}
              color={active ? '#fff' : theme.colors.textMuted}
            >
              {opt.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pure data transforms (no hooks) — easy to reason about and test.
// ---------------------------------------------------------------------------

/** Positive-only spend for a transaction (Plaid: amount > 0 = money out). */
function spendOf(t: Transaction): number {
  return t.amount > 0 ? t.amount : 0;
}

/** 'YYYY-MM' -> 'Mon' (falls back to the raw key if unparseable). */
function shortMonthLabel(month: string): string {
  const m = Number(month.split('-')[1]);
  return MONTH_LABELS[m - 1] ?? month;
}

/**
 * Build the spend-over-time series for the line/area chart at the requested
 * granularity, spanning all six months oldest→newest.
 *   - day:   one point per calendar day that has any transaction, chronological.
 *   - week:  ISO-ish weekly buckets keyed by the week's Monday date.
 *   - month: one point per month key (always all six, even if zero).
 */
function buildLinePoints(
  txnsByMonth: Transaction[][],
  monthKeys: string[],
  granularity: Granularity,
  tz: string,
): { label: string; value: number }[] {
  if (granularity === 'month') {
    return monthKeys.map((mk, i) => ({
      label: shortMonthLabel(mk),
      value: (txnsByMonth[i] ?? []).reduce((s, t) => s + spendOf(t), 0),
    }));
  }

  const all = txnsByMonth.flat();
  const buckets = new Map<string, number>();

  for (const t of all) {
    const spend = spendOf(t);
    if (spend <= 0) continue;
    const d = t.date.toDate();
    const dateKey = toDateKey(d, tz); // 'YYYY-MM-DD'
    const bucketKey = granularity === 'day' ? dateKey : weekStartKey(dateKey);
    buckets.set(bucketKey, (buckets.get(bucketKey) ?? 0) + spend);
  }

  const sortedKeys = [...buckets.keys()].sort();
  return sortedKeys.map((key) => ({
    label: granularity === 'day' ? dayLabel(key) : weekLabel(key),
    value: buckets.get(key) ?? 0,
  }));
}

/** Monday-of-week date key ('YYYY-MM-DD') for a given 'YYYY-MM-DD'. */
function weekStartKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const dow = dt.getUTCDay(); // 0=Sun..6=Sat
  const deltaToMonday = (dow + 6) % 7; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - deltaToMonday);
  return dt.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' -> 'M/D' compact label. */
function dayLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${m}/${d}`;
}

/** Week bucket 'YYYY-MM-DD' (Monday) -> 'M/D' label of the week start. */
function weekLabel(weekKey: string): string {
  return dayLabel(weekKey);
}

/**
 * Rank category ids by total spend across the whole window and return the top N.
 * A transaction with no categoryId is bucketed under the '__uncat__' sentinel so
 * uncategorized spend still surfaces if it dominates.
 */
function rankTopCategories(txnsByMonth: Transaction[][], n: number): string[] {
  const totals = new Map<string, number>();
  for (const t of txnsByMonth.flat()) {
    const spend = spendOf(t);
    if (spend <= 0) continue;
    const id = t.categoryId ?? '__uncat__';
    totals.set(id, (totals.get(id) ?? 0) + spend);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id);
}

/** Resolve a display name + color for a category id from the loaded categories. */
function resolveCategory(
  id: string,
  categories: { categoryId: string; name: string; color: string }[],
  fallbackName: string | null,
): { name: string; color: string } {
  if (id === '__uncat__') {
    return { name: 'Uncategorized', color: theme.colors.textFaint };
  }
  const cat = categories.find((c) => c.categoryId === id);
  return {
    name: cat?.name ?? fallbackName ?? 'Category',
    color: cat?.color ?? fallbackCategoryColor(id),
  };
}

/** First transaction name we can find for a category id (used as a name fallback). */
function firstNameForCategory(txnsByMonth: Transaction[][], id: string): string | null {
  for (const arr of txnsByMonth) {
    for (const t of arr) {
      if ((t.categoryId ?? '__uncat__') === id) return t.categoryName ?? null;
    }
  }
  return null;
}

/** One stacked-bar series per top category, with a spend value per month. */
function buildStackedSeries(
  txnsByMonth: Transaction[][],
  topCategoryIds: string[],
  categories: { categoryId: string; name: string; color: string }[],
): CategoryStackedBarSeries[] {
  return topCategoryIds.map((id) => {
    const meta = resolveCategory(id, categories, firstNameForCategory(txnsByMonth, id));
    const values = txnsByMonth.map((arr) =>
      arr.reduce((s, t) => s + ((t.categoryId ?? '__uncat__') === id ? spendOf(t) : 0), 0),
    );
    return { categoryName: meta.name, color: meta.color, values };
  });
}

/**
 * Grouped-bar payload: for each top category, this-month and last-month spend.
 * Labels are the category display names.
 */
function buildGrouped(
  txnsByMonth: Transaction[][],
  topCategoryIds: string[],
  categories: { categoryId: string; name: string; color: string }[],
): { labels: string[]; current: number[]; previous: number[] } {
  const currentIdx = txnsByMonth.length - 1;
  const prevIdx = txnsByMonth.length - 2;
  const currentArr = txnsByMonth[currentIdx] ?? [];
  const prevArr = prevIdx >= 0 ? txnsByMonth[prevIdx] ?? [] : [];

  const labels: string[] = [];
  const current: number[] = [];
  const previous: number[] = [];

  for (const id of topCategoryIds) {
    const meta = resolveCategory(id, categories, firstNameForCategory(txnsByMonth, id));
    labels.push(meta.name);
    current.push(
      currentArr.reduce((s, t) => s + ((t.categoryId ?? '__uncat__') === id ? spendOf(t) : 0), 0),
    );
    previous.push(
      prevArr.reduce((s, t) => s + ((t.categoryId ?? '__uncat__') === id ? spendOf(t) : 0), 0),
    );
  }

  return { labels, current, previous };
}

/**
 * Cumulative spend across the current month's days, one point per day up to the
 * last day that has activity. Days with no spend still advance the running total.
 */
function buildBurnCumulative(
  currentMonthTxns: Transaction[],
  tz: string,
): { label: string; value: number }[] {
  if (currentMonthTxns.length === 0) return [];

  const perDay = new Map<string, number>();
  let month = '';
  for (const t of currentMonthTxns) {
    const spend = spendOf(t);
    if (spend <= 0) continue;
    const dateKey = toDateKey(t.date.toDate(), tz);
    month = dateKey.slice(0, 7);
    perDay.set(dateKey, (perDay.get(dateKey) ?? 0) + spend);
  }
  if (perDay.size === 0) return [];

  // Walk day 1..lastActiveDay, accumulating so the burn line is monotonic.
  const lastDay = Math.max(
    ...[...perDay.keys()].map((k) => Number(k.split('-')[2])),
  );
  const points: { label: string; value: number }[] = [];
  let running = 0;
  for (let day = 1; day <= lastDay; day++) {
    const key = `${month}-${String(day).padStart(2, '0')}`;
    running += perDay.get(key) ?? 0;
    points.push({ label: String(day), value: running });
  }
  return points;
}
