/**
 * Dashboard / home screen. The at-a-glance view of the current month: total
 * spend with a month-over-month delta and pace projection, a category donut,
 * budget progress for the biggest categories, a daily-spend sparkline, top
 * merchants, and the latest AI insight.
 *
 * All the math lives in `useMonthStats`; this screen only arranges + renders it.
 * Sign convention (Plaid): amount > 0 = spend, < 0 = income. Spend totals are
 * already positive coming out of the stats hook.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { toMonthKey } from '@expense/shared';
import { useAccounts, useInsights, useMonthStats } from '@/hooks';
import {
  Badge,
  Card,
  Divider,
  EmptyState,
  LoadingState,
  Money,
  ProgressBar,
  Screen,
  SectionHeader,
  ThemedText,
} from '@/components/ui';
import { SpendDonut, SpendLineArea, TopMerchantsBar } from '@/components/charts';
import { theme } from '@/theme';

const DEVICE_TZ =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

/**
 * Month key ('YYYY-MM') immediately before the given key. Derived purely from
 * the string so it stays consistent with the tz-based `currentMonth` used by
 * the stats hook (no local-time drift at month boundaries).
 */
function previousMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

/** Friendly "July 2026" label from a 'YYYY-MM' month key. */
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

const SEVERITY_COLOR: Record<'info' | 'warn' | 'alert', string> = {
  info: theme.colors.primary,
  warn: theme.colors.warn,
  alert: theme.colors.danger,
};

export default function DashboardScreen() {
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const currentMonth = useMemo(() => toMonthKey(now, DEVICE_TZ), [now]);
  const prevMonth = useMemo(() => previousMonthKey(currentMonth), [currentMonth]);

  const accountsQ = useAccounts();
  const statsQ = useMonthStats(currentMonth);
  const prevStatsQ = useMonthStats(prevMonth);
  const insightsQ = useInsights();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        accountsQ.refetch(),
        statsQ.refetch(),
        prevStatsQ.refetch(),
        insightsQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [accountsQ, statsQ, prevStatsQ, insightsQ]);

  const stats = statsQ.data;
  const accounts = accountsQ.data;

  // Month-over-month delta on total spend. Null when we can't compute a
  // meaningful percentage (no prior spend yet).
  const momDeltaPct = useMemo<number | null>(() => {
    const prev = prevStatsQ.data?.monthToDateSpend ?? 0;
    if (!stats || prev <= 0) return null;
    return (stats.monthToDateSpend - prev) / prev;
  }, [stats, prevStatsQ.data]);

  // Daily-spend sparkline points, sorted by date ascending.
  const sparkPoints = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, value]) => ({
        // dateKey is 'YYYY-MM-DD'; label with the day-of-month.
        label: String(Number(dateKey.slice(8, 10))),
        value,
      }));
  }, [stats]);

  // Donut slices from category spend.
  const donutData = useMemo(
    () =>
      (stats?.perCategory ?? []).map((c) => ({
        label: c.categoryName,
        value: c.total,
        color: c.color,
      })),
    [stats],
  );

  // The biggest categories that actually have a budget set.
  const budgetedCategories = useMemo(
    () =>
      (stats?.perCategory ?? [])
        .filter((c) => c.budget != null && c.budget > 0)
        .slice(0, 4),
    [stats],
  );

  const latestInsight = insightsQ.data?.[0];
  const firstTip = latestInsight?.tips?.[0];

  // First meaningful load: accounts + current-month stats. (Prev month and
  // insights are supplementary and shouldn't block the whole screen.)
  const initialLoading =
    (accountsQ.isLoading && accounts === undefined) ||
    (statsQ.isLoading && stats === undefined);

  if (initialLoading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  // No linked bank → nothing to show. Point the user at Settings to connect.
  if (!accounts || accounts.length === 0) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <EmptyState
          icon="card-outline"
          title="No accounts linked yet"
          subtitle="Connect a bank account to see your spending, budgets, and insights here."
          actionLabel="Go to Settings"
          onAction={() => router.push('/(tabs)/settings')}
        />
      </Screen>
    );
  }

  const monthToDateSpend = stats?.monthToDateSpend ?? 0;
  const projectedMonthEndSpend = stats?.projectedMonthEndSpend ?? 0;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {/* (1) Big month spend total ------------------------------------- */}
      <View style={{ marginTop: theme.spacing(2) }}>
        <ThemedText variant="label" weight="medium" color={theme.colors.textMuted}>
          {monthLabel(currentMonth)} spend
        </ThemedText>
        <View style={{ marginTop: theme.spacing(1) }}>
          <Money amount={monthToDateSpend} variant="display" weight="bold" colorBySign={false} />
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: theme.spacing(2),
            marginTop: theme.spacing(2),
          }}
        >
          <MoMDelta pct={momDeltaPct} />
          <ThemedText variant="label" color={theme.colors.textMuted}>
            Projected month-end {formatCompactMoney(projectedMonthEndSpend)}
          </ThemedText>
        </View>
      </View>

      {/* (2) Category donut -------------------------------------------- */}
      <SectionHeader
        title="By category"
        actionLabel="Trends"
        onAction={() => router.push('/(tabs)/trends')}
      />
      <Card>
        <SpendDonut
          data={donutData}
          centerLabel="this month"
          centerValue={formatCompactMoney(monthToDateSpend)}
        />
      </Card>

      {/* (3) Budget progress ------------------------------------------- */}
      {budgetedCategories.length > 0 ? (
        <>
          <SectionHeader
            title="Budgets"
            actionLabel="Manage"
            onAction={() => router.push('/(tabs)/budgets')}
          />
          <Card>
            <View style={{ gap: theme.spacing(4) }}>
              {budgetedCategories.map((c) => {
                const pct = c.consumedPct ?? 0;
                const over = pct > 1;
                return (
                  <View key={c.categoryId}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: theme.spacing(1.5),
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing(2),
                          flex: 1,
                          marginRight: theme.spacing(2),
                        }}
                      >
                        <View
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: c.color,
                          }}
                        />
                        <ThemedText variant="label" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                          {c.categoryName}
                        </ThemedText>
                      </View>
                      <ThemedText
                        variant="label"
                        weight="semibold"
                        color={over ? theme.colors.danger : theme.colors.textMuted}
                      >
                        {formatCompactMoney(c.total)} / {formatCompactMoney(c.budget ?? 0)}
                      </ThemedText>
                    </View>
                    <ProgressBar pct={pct} color={c.color} />
                  </View>
                );
              })}
            </View>
          </Card>
        </>
      ) : null}

      {/* (4) Daily-spend sparkline ------------------------------------- */}
      <SectionHeader title="Daily spend" />
      <Card>
        <SpendLineArea points={sparkPoints} color={theme.colors.primary} />
      </Card>

      {/* (5) Top merchants --------------------------------------------- */}
      <SectionHeader title="Top merchants" />
      <Card>
        <TopMerchantsBar
          data={(stats?.topMerchants ?? []).map((m) => ({
            merchantName: m.merchantName,
            total: m.total,
          }))}
        />
      </Card>

      {/* (6) Latest AI insight ----------------------------------------- */}
      <SectionHeader
        title="Latest insight"
        actionLabel="See all"
        onAction={() => router.push('/(tabs)/insights')}
      />
      {firstTip ? (
        <Card onPress={() => router.push('/(tabs)/insights')}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: theme.spacing(2),
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2), flex: 1 }}>
              <Ionicons name="sparkles" size={18} color={SEVERITY_COLOR[firstTip.severity]} />
              <ThemedText variant="body" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                {firstTip.title}
              </ThemedText>
            </View>
            <Badge label={firstTip.severity} color={SEVERITY_COLOR[firstTip.severity]} />
          </View>
          <Divider />
          <ThemedText variant="label" color={theme.colors.textMuted} numberOfLines={3}>
            {firstTip.body}
          </ThemedText>
        </Card>
      ) : (
        <Card>
          <ThemedText variant="label" color={theme.colors.textMuted}>
            No insights yet. Check back after your next nightly sync.
          </ThemedText>
        </Card>
      )}
    </Screen>
  );
}

/** Month-over-month delta chip: green when spending is down, amber when up. */
function MoMDelta({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <ThemedText variant="label" color={theme.colors.textMuted}>
        No prior month to compare
      </ThemedText>
    );
  }
  const up = pct > 0;
  const flat = Math.abs(pct) < 0.005;
  const color = flat ? theme.colors.textMuted : up ? theme.colors.warn : theme.colors.success;
  const icon = flat ? 'remove' : up ? 'arrow-up' : 'arrow-down';
  const label = `${Math.abs(pct * 100).toFixed(0)}% vs last month`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1) }}>
      <Ionicons name={icon} size={14} color={color} />
      <ThemedText variant="label" weight="semibold" color={color}>
        {label}
      </ThemedText>
    </View>
  );
}

/** Compact currency (e.g. "$1.2k") for tight labels. Always non-negative here. */
function formatCompactMoney(value: number): string {
  const v = Math.abs(value);
  if (v >= 1000) {
    const k = v / 1000;
    return `$${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return `$${Math.round(v)}`;
}
