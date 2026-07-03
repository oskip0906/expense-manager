/**
 * SpendDonut — category spend breakdown rendered as a donut (PieChart with a
 * hollow center). The center shows an optional label/value (typically total
 * spend). Colors come from each data slice; everything else is themed.
 */
import React from 'react';
import { View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';
import { theme } from '@/theme';
import { ThemedText } from '@/components/ui';
import { ChartEmpty } from './_shared';

export type SpendDonutDatum = { label: string; value: number; color: string };

export function SpendDonut({
  data,
  centerLabel,
  centerValue,
}: {
  data: SpendDonutDatum[];
  centerLabel?: string;
  centerValue?: string;
}) {
  // Only positive, non-zero slices are meaningful in a donut.
  const slices = data.filter((d) => d.value > 0);
  const total = slices.reduce((sum, d) => sum + d.value, 0);

  if (slices.length === 0 || total <= 0) {
    return <ChartEmpty label="No spending to break down yet." />;
  }

  const pieData = slices.map((d) => ({ value: d.value, color: d.color }));

  return (
    <View style={{ alignItems: 'center', paddingVertical: theme.spacing(2) }}>
      <PieChart
        data={pieData}
        donut
        radius={110}
        innerRadius={72}
        innerCircleColor={theme.colors.surface}
        strokeColor={theme.colors.surface}
        strokeWidth={2}
        centerLabelComponent={() => (
          <View style={{ alignItems: 'center' }}>
            {centerValue ? (
              <ThemedText variant="title" weight="bold">
                {centerValue}
              </ThemedText>
            ) : null}
            {centerLabel ? (
              <ThemedText variant="caption" weight="medium" color={theme.colors.textMuted}>
                {centerLabel}
              </ThemedText>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}
