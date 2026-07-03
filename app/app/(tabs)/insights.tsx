/**
 * Insights feed — the AI suggestions produced by the nightly pipeline.
 *
 * `useInsights()` returns Insight docs already sorted date-desc. Each doc becomes
 * a Card: a human date header, one row per tip (title/body, colored by severity),
 * and a compact stats footer (month-to-date spend + MoM delta). Tapping a tip that
 * carries a categoryId deep-links to the transactions tab filtered to that category.
 */
import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Insight, InsightTip } from '@expense/shared';
import {
  Screen,
  Card,
  ThemedText,
  Money,
  Badge,
  Divider,
  EmptyState,
  LoadingState,
} from '@/components/ui';
import { useInsights } from '@/hooks';
import { theme } from '@/theme';

export default function InsightsScreen() {
  const insights = useInsights();
  const router = useRouter();

  const openCategory = React.useCallback(
    (categoryId: string) => {
      router.push({ pathname: '/(tabs)/transactions', params: { categoryId } });
    },
    [router],
  );

  const onRefresh = React.useCallback(() => {
    insights.refetch();
  }, [insights]);

  if (insights.isLoading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  const docs = insights.data ?? [];

  if (docs.length === 0) {
    return (
      <Screen>
        <ThemedText variant="display" weight="bold" style={styles.title}>
          Insights
        </ThemedText>
        <EmptyState
          icon="sparkles-outline"
          title="No insights yet"
          subtitle="Insights arrive after your first nightly sync."
        />
      </Screen>
    );
  }

  return (
    <Screen refreshing={insights.isRefetching} onRefresh={onRefresh}>
      <ThemedText variant="display" weight="bold" style={styles.title}>
        Insights
      </ThemedText>
      {docs.map((insight) => (
        <InsightCard key={insight.date} insight={insight} onOpenCategory={openCategory} />
      ))}
    </Screen>
  );
}

function InsightCard({
  insight,
  onOpenCategory,
}: {
  insight: Insight;
  onOpenCategory: (categoryId: string) => void;
}) {
  const tips = insight.tips ?? [];
  return (
    <Card style={styles.card}>
      <ThemedText variant="label" weight="semibold" color={theme.colors.textMuted}>
        {formatInsightDate(insight.date)}
      </ThemedText>

      {tips.length === 0 ? (
        <ThemedText color={theme.colors.textFaint} style={styles.noTips}>
          No suggestions for this day.
        </ThemedText>
      ) : (
        tips.map((tip, i) => (
          <React.Fragment key={tip.id}>
            {i > 0 ? <Divider /> : <View style={styles.firstTipSpacer} />}
            <TipRow tip={tip} onOpenCategory={onOpenCategory} />
          </React.Fragment>
        ))
      )}

      <Divider />
      <StatsLine insight={insight} />
    </Card>
  );
}

function TipRow({
  tip,
  onOpenCategory,
}: {
  tip: InsightTip;
  onOpenCategory: (categoryId: string) => void;
}) {
  const accent = severityColor(tip.severity);
  const canOpen = tip.categoryId != null;

  const body = (
    <View style={styles.tipRow}>
      <View style={[styles.severityDot, { backgroundColor: accent }]} />
      <View style={styles.tipBody}>
        <View style={styles.tipHeader}>
          <ThemedText variant="body" weight="semibold" style={styles.tipTitle}>
            {tip.title}
          </ThemedText>
          {tip.severity !== 'info' ? (
            <Badge label={tip.severity.toUpperCase()} color={accent} />
          ) : null}
        </View>
        <ThemedText color={theme.colors.textMuted} style={styles.tipText}>
          {tip.body}
        </ThemedText>
        {canOpen ? (
          <View style={styles.tipLink}>
            <ThemedText variant="label" weight="semibold" color={theme.colors.primary}>
              View transactions
            </ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.colors.primary} />
          </View>
        ) : null}
      </View>
    </View>
  );

  if (canOpen) {
    return (
      <Pressable
        onPress={() => onOpenCategory(tip.categoryId as string)}
        style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
      >
        {body}
      </Pressable>
    );
  }
  return body;
}

function StatsLine({ insight }: { insight: Insight }) {
  const { monthToDateSpend, momDeltaPct } = insight.stats;
  return (
    <View style={styles.statsLine}>
      <View style={styles.statBlock}>
        <ThemedText variant="caption" weight="semibold" color={theme.colors.textFaint}>
          MONTH TO DATE
        </ThemedText>
        <Money amount={monthToDateSpend} weight="semibold" colorBySign={false} />
      </View>
      <View style={[styles.statBlock, styles.statBlockRight]}>
        <ThemedText variant="caption" weight="semibold" color={theme.colors.textFaint}>
          VS LAST MONTH
        </ThemedText>
        <MomDelta pct={momDeltaPct} />
      </View>
    </View>
  );
}

function MomDelta({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <ThemedText weight="semibold" color={theme.colors.textMuted}>
        —
      </ThemedText>
    );
  }
  const up = pct > 0;
  // Rising spend is the unwelcome direction, so tint increases red / drops green.
  const color = up ? theme.colors.danger : theme.colors.success;
  const sign = up ? '+' : '';
  return (
    <View style={styles.deltaRow}>
      <Ionicons
        name={up ? 'trending-up' : 'trending-down'}
        size={15}
        color={color}
        style={styles.deltaIcon}
      />
      <ThemedText weight="semibold" color={color}>
        {sign}
        {Math.round(pct * 100)}%
      </ThemedText>
    </View>
  );
}

function severityColor(severity: InsightTip['severity']): string {
  switch (severity) {
    case 'alert':
      return theme.colors.danger;
    case 'warn':
      return theme.colors.warn;
    default:
      return theme.colors.textMuted;
  }
}

/** 'YYYY-MM-DD' -> e.g. "Wednesday, July 2". Falls back to the raw key if unparseable. */
function formatInsightDate(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  title: { marginBottom: theme.spacing(2) },
  card: { marginTop: theme.spacing(3) },
  firstTipSpacer: { height: theme.spacing(3) },
  noTips: { marginTop: theme.spacing(3) },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing(3) },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: theme.spacing(1.5),
  },
  tipBody: { flex: 1 },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  },
  tipTitle: { flex: 1 },
  tipText: { marginTop: theme.spacing(1) },
  tipLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
  },
  statsLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  statBlock: { gap: theme.spacing(1) },
  statBlockRight: { alignItems: 'flex-end' },
  deltaRow: { flexDirection: 'row', alignItems: 'center' },
  deltaIcon: { marginRight: theme.spacing(1) },
});
