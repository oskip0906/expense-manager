/**
 * BurnVsBudgetChart — cumulative spend "burn" over the period drawn as a line,
 * with a horizontal budget reference line. The line turns red once cumulative
 * spend crosses the budget cap so overspend is obvious at a glance.
 */
import React from 'react';
import { View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { theme } from '@/theme';
import { ThemedText } from '@/components/ui';
import { ChartEmpty, chartWidth, compactAmount } from './_shared';

export function BurnVsBudgetChart({
  cumulative,
  budget,
}: {
  cumulative: { label: string; value: number }[];
  budget: number;
}) {
  const hasAnyValue = cumulative.some((p) => p.value !== 0);
  if (cumulative.length === 0 || !hasAnyValue) {
    return <ChartEmpty label="No spend recorded for this period yet." />;
  }

  const peak = Math.max(...cumulative.map((p) => p.value));
  const over = budget > 0 && peak > budget;
  const lineColor = over ? theme.colors.danger : theme.colors.primary;

  const step = Math.max(1, Math.ceil(cumulative.length / 6));
  const data = cumulative.map((p, i) => ({
    value: p.value,
    label: i % step === 0 ? p.label : '',
    labelTextStyle: { color: theme.colors.textFaint, fontSize: theme.font.caption },
  }));

  // Axis must contain both the burn peak and the budget line.
  const maxValue = niceCeil(Math.max(peak, budget, 1));
  const width = chartWidth();

  return (
    <View>
      <LineChart
        areaChart
        data={data}
        width={width}
        adjustToWidth
        color={lineColor}
        thickness={2}
        startFillColor={lineColor}
        endFillColor={lineColor}
        startOpacity={0.28}
        endOpacity={0.02}
        hideDataPoints
        curved
        noOfSections={4}
        maxValue={maxValue}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={theme.colors.border}
        rulesColor={theme.colors.border}
        rulesType="solid"
        initialSpacing={0}
        endSpacing={0}
        yAxisTextStyle={{ color: theme.colors.textFaint, fontSize: theme.font.caption }}
        formatYLabel={(label: string) => compactAmount(Number(label))}
        // Horizontal budget reference line.
        showReferenceLine1={budget > 0}
        referenceLine1Position={budget}
        referenceLine1Config={{
          color: theme.colors.warn,
          dashWidth: 6,
          dashGap: 4,
          thickness: 1,
        }}
        isAnimated
      />
      {budget > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing(1.5),
            marginTop: theme.spacing(3),
          }}
        >
          <View style={{ width: 14, height: 2, backgroundColor: theme.colors.warn }} />
          <ThemedText variant="caption" color={theme.colors.textMuted}>
            {`Budget ${compactAmount(budget)}`}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}
