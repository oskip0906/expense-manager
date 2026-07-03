/**
 * CategoryStackedBar — one stacked bar per month. Each stack is composed of the
 * per-category series values at that month's index. A compact legend maps each
 * series color to its category name.
 */
import React from 'react';
import { View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { theme } from '@/theme';
import { ThemedText } from '@/components/ui';
import { ChartEmpty, chartWidth, compactAmount } from './_shared';

export type CategoryStackedBarSeries = {
  categoryName: string;
  color: string;
  values: number[];
};

export function CategoryStackedBar({
  months,
  series,
}: {
  months: string[];
  series: CategoryStackedBarSeries[];
}) {
  const hasAnyValue = series.some((s) => s.values.some((v) => v > 0));
  if (months.length === 0 || series.length === 0 || !hasAnyValue) {
    return <ChartEmpty label="Not enough history to compare months." />;
  }

  // Build one stackData entry per month; each stack element is a series value.
  const stackData = months.map((month, monthIdx) => ({
    label: shortMonth(month),
    stacks: series
      .map((s) => ({ value: Math.max(0, s.values[monthIdx] ?? 0), color: s.color }))
      .filter((seg) => seg.value > 0),
  }));

  const maxTotal = Math.max(
    ...stackData.map((s) => s.stacks.reduce((sum, seg) => sum + seg.value, 0)),
    1,
  );

  const width = chartWidth();
  const barWidth = Math.max(18, Math.min(40, Math.floor(width / (months.length * 2))));

  return (
    <View>
      <BarChart
        stackData={stackData}
        width={width}
        barWidth={barWidth}
        spacing={Math.max(12, barWidth)}
        initialSpacing={theme.spacing(3)}
        noOfSections={4}
        maxValue={niceCeil(maxTotal)}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={theme.colors.border}
        rulesColor={theme.colors.border}
        rulesType="solid"
        yAxisTextStyle={{ color: theme.colors.textFaint, fontSize: theme.font.caption }}
        xAxisLabelTextStyle={{ color: theme.colors.textMuted, fontSize: theme.font.caption }}
        formatYLabel={(label: string) => compactAmount(Number(label))}
        isAnimated
      />
      <Legend series={series} />
    </View>
  );
}

function Legend({ series }: { series: CategoryStackedBarSeries[] }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.spacing(2),
        marginTop: theme.spacing(3),
      }}
    >
      {series.map((s) => (
        <View key={s.categoryName} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1.5) }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} />
          <ThemedText variant="caption" color={theme.colors.textMuted}>
            {s.categoryName}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** 'YYYY-MM' -> short month label like "Jan". */
function shortMonth(month: string): string {
  const [, m] = month.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[(m ?? 1) - 1] ?? month;
}

/** Round an axis max up to a friendly number so gridlines look clean. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}
