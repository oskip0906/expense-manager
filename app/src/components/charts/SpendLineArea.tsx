/**
 * SpendLineArea — a smooth area chart of a single value series over labeled
 * points (e.g. daily cumulative spend). Uses gifted-charts' areaChart mode with
 * a vertical gradient fading from the line color to transparent.
 */
import React from 'react';
import { View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { theme } from '@/theme';
import { ChartEmpty, chartWidth, compactAmount } from './_shared';

export function SpendLineArea({
  points,
  color = theme.colors.primary,
}: {
  points: { label: string; value: number }[];
  color?: string;
}) {
  const hasAnyValue = points.some((p) => p.value !== 0);
  if (points.length === 0 || !hasAnyValue) {
    return <ChartEmpty label="No activity to chart yet." />;
  }

  // Label only a handful of x-points to avoid overlap on dense series.
  const step = Math.max(1, Math.ceil(points.length / 6));
  const data = points.map((p, i) => ({
    value: p.value,
    label: i % step === 0 ? p.label : '',
    labelTextStyle: { color: theme.colors.textFaint, fontSize: theme.font.caption },
  }));

  const maxValue = Math.max(...points.map((p) => p.value), 1);
  const width = chartWidth();

  return (
    <View>
      <LineChart
        areaChart
        data={data}
        width={width}
        adjustToWidth
        color={color}
        thickness={2}
        startFillColor={color}
        endFillColor={color}
        startOpacity={0.35}
        endOpacity={0.02}
        hideDataPoints
        curved
        noOfSections={4}
        maxValue={niceCeil(maxValue)}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={theme.colors.border}
        rulesColor={theme.colors.border}
        rulesType="solid"
        initialSpacing={0}
        endSpacing={0}
        yAxisTextStyle={{ color: theme.colors.textFaint, fontSize: theme.font.caption }}
        formatYLabel={(label: string) => compactAmount(Number(label))}
        isAnimated
      />
    </View>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}
