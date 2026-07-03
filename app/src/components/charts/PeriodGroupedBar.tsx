/**
 * PeriodGroupedBar — side-by-side comparison of two periods (e.g. this month vs
 * last month) across a set of labels. Current and previous values are
 * interleaved into grouped pairs; a small legend explains the two colors.
 */
import React from 'react';
import { View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { theme } from '@/theme';
import { ThemedText } from '@/components/ui';
import { ChartEmpty, chartWidth, compactAmount } from './_shared';

export function PeriodGroupedBar({
  labels,
  current,
  previous,
  currentLabel = 'Current',
  previousLabel = 'Previous',
}: {
  labels: string[];
  current: number[];
  previous: number[];
  currentLabel?: string;
  previousLabel?: string;
}) {
  const hasAnyValue = current.some((v) => v > 0) || previous.some((v) => v > 0);
  if (labels.length === 0 || !hasAnyValue) {
    return <ChartEmpty label="Nothing to compare for this period." />;
  }

  const currentColor = theme.colors.primary;
  const previousColor = theme.colors.surfaceAlt;

  // Interleave [current, previous] per label so bars render as grouped pairs.
  // Only the first bar of each pair carries the x-axis label + spacing gap.
  const barData = labels.flatMap((label, i) => {
    const cur = Math.max(0, current[i] ?? 0);
    const prev = Math.max(0, previous[i] ?? 0);
    return [
      { value: cur, label, spacing: 2, frontColor: currentColor },
      { value: prev, frontColor: previousColor },
    ];
  });

  const maxValue = Math.max(...current, ...previous, 1);

  const width = chartWidth();
  const groups = Math.max(labels.length, 1);
  const barWidth = Math.max(10, Math.min(22, Math.floor(width / (groups * 3))));

  return (
    <View>
      <BarChart
        data={barData}
        width={width}
        barWidth={barWidth}
        spacing={Math.max(18, barWidth * 1.6)}
        initialSpacing={theme.spacing(3)}
        noOfSections={4}
        maxValue={niceCeil(maxValue)}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={theme.colors.border}
        rulesColor={theme.colors.border}
        rulesType="solid"
        barBorderRadius={4}
        yAxisTextStyle={{ color: theme.colors.textFaint, fontSize: theme.font.caption }}
        xAxisLabelTextStyle={{ color: theme.colors.textMuted, fontSize: theme.font.caption }}
        formatYLabel={(label: string) => compactAmount(Number(label))}
        isAnimated
      />
      <View
        style={{
          flexDirection: 'row',
          gap: theme.spacing(4),
          marginTop: theme.spacing(3),
        }}
      >
        <LegendItem color={currentColor} label={currentLabel} />
        <LegendItem color={previousColor} label={previousLabel} />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1.5) }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <ThemedText variant="caption" color={theme.colors.textMuted}>
        {label}
      </ThemedText>
    </View>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}
