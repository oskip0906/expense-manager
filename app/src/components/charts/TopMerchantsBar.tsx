/**
 * TopMerchantsBar — horizontal bars ranking merchants by total spend, sorted
 * descending. Built with manual themed bars (rather than gifted-charts
 * horizontal mode) so the merchant name and amount can sit inline with each
 * bar and wrap gracefully on narrow screens.
 */
import React from 'react';
import { View } from 'react-native';
import { theme } from '@/theme';
import { ThemedText, formatMoney } from '@/components/ui';
import { ChartEmpty } from './_shared';

export function TopMerchantsBar({
  data,
}: {
  data: { merchantName: string; total: number }[];
}) {
  const rows = data.filter((d) => d.total > 0).sort((a, b) => b.total - a.total);
  if (rows.length === 0) {
    return <ChartEmpty label="No merchant spending yet." />;
  }

  const max = Math.max(...rows.map((r) => r.total), 1);

  return (
    <View style={{ gap: theme.spacing(3) }}>
      {rows.map((r, i) => {
        const pct = Math.max(0.02, r.total / max); // keep tiny bars visible
        // Cycle the palette-ish emphasis: rank 1 gets primary, rest muted.
        const barColor = i === 0 ? theme.colors.primary : theme.colors.primaryMuted;
        return (
          <View key={`${r.merchantName}-${i}`}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: theme.spacing(1),
              }}
            >
              <ThemedText variant="label" weight="medium" numberOfLines={1} style={{ flex: 1, marginRight: theme.spacing(2) }}>
                {r.merchantName}
              </ThemedText>
              <ThemedText variant="label" weight="semibold" color={theme.colors.textMuted}>
                {formatMoney(r.total)}
              </ThemedText>
            </View>
            <View
              style={{
                height: 10,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.surfaceAlt,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${pct * 100}%`,
                  height: 10,
                  borderRadius: theme.radius.pill,
                  backgroundColor: barColor,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
