/**
 * BudgetRing — a circular progress ring (SVG) showing how much of a budget cap
 * has been consumed. The arc fills clockwise from the top; it turns red once
 * consumedPct exceeds 1 (over budget). Center text shows the percentage; below
 * the ring we print amount / cap.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { theme } from '@/theme';
import { ThemedText, formatMoney } from '@/components/ui';

export function BudgetRing({
  label,
  consumedPct,
  color,
  amount,
  cap,
}: {
  label: string;
  consumedPct: number;
  color: string;
  amount: number;
  cap: number;
}) {
  const size = 120;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const over = consumedPct > 1;
  const arcColor = over ? theme.colors.danger : color;
  // Visible fill is clamped to a full ring; overspend is signalled by color.
  const fillFraction = Math.max(0, Math.min(1, consumedPct));
  const dashOffset = circumference * (1 - fillFraction);
  const pctText = `${Math.round(consumedPct * 100)}%`;

  return (
    <View style={{ alignItems: 'center', paddingVertical: theme.spacing(2) }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          {/* Track */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.colors.surfaceAlt}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress arc — rotated -90deg so it starts at 12 o'clock. */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={arcColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <ThemedText variant="heading" weight="bold" color={over ? theme.colors.danger : theme.colors.text}>
            {pctText}
          </ThemedText>
        </View>
      </View>
      <ThemedText variant="label" weight="semibold" style={{ marginTop: theme.spacing(2) }} numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText variant="caption" color={theme.colors.textMuted} style={{ marginTop: theme.spacing(0.5) }}>
        {`${formatMoney(amount)} / ${formatMoney(cap)}`}
      </ThemedText>
    </View>
  );
}
