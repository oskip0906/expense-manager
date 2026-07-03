/**
 * CalendarHeatmap — a month grid (weeks x weekdays) where each day cell is
 * shaded by that day's spend. Intensity interpolates from surfaceAlt (no spend)
 * to primary (the month's max). Leading/trailing padding days render as empty
 * (transparent) cells so the calendar aligns to weekdays.
 *
 * The grid is derived purely from the 'YYYY-MM' month string using UTC date
 * math, so it never drifts with the device timezone.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { theme } from '@/theme';
import { ThemedText } from '@/components/ui';
import { ChartEmpty, chartWidth, lerpHexColor } from './_shared';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function CalendarHeatmap({
  month,
  byDay,
}: {
  month: string; // 'YYYY-MM'
  byDay: Record<string, number>; // key 'YYYY-MM-DD' -> spend
}) {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr); // 1..12
  const valid = Number.isFinite(year) && monthNum >= 1 && monthNum <= 12;

  const values = Object.values(byDay);
  const maxSpend = values.length ? Math.max(...values, 0) : 0;

  if (!valid || maxSpend <= 0) {
    return <ChartEmpty label="No daily spend to map for this month." />;
  }

  // First weekday of the month (0=Sun) and number of days, via UTC.
  const firstWeekday = new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay();
  const numDays = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();

  const totalCells = firstWeekday + numDays;
  const numWeeks = Math.ceil(totalCells / 7);

  const width = chartWidth();
  const gap = theme.spacing(1);
  const cell = Math.floor((width - gap * 6) / 7);
  const svgWidth = cell * 7 + gap * 6;
  const gridHeight = numWeeks * cell + (numWeeks - 1) * gap;

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstWeekday + 1; // 1..numDays for real days
    const col = i % 7;
    const row = Math.floor(i / 7);
    const x = col * (cell + gap);
    const y = row * (cell + gap);

    if (dayNum < 1) {
      // Leading padding day — empty cell (drawn faintly so grid stays legible).
      continue;
    }

    const key = `${month}-${String(dayNum).padStart(2, '0')}`;
    const spend = byDay[key] ?? 0;
    const t = maxSpend > 0 ? spend / maxSpend : 0;
    const fill =
      spend > 0
        ? lerpHexColor(theme.colors.surfaceAlt, theme.colors.primary, t)
        : theme.colors.surfaceAlt;

    cells.push(
      <Rect
        key={key}
        x={x}
        y={y}
        width={cell}
        height={cell}
        rx={theme.radius.sm}
        ry={theme.radius.sm}
        fill={fill}
        stroke={theme.colors.border}
        strokeWidth={0.5}
      />,
    );
  }

  return (
    <View style={{ alignItems: 'center' }}>
      {/* Weekday header */}
      <View style={{ flexDirection: 'row', width: svgWidth, marginBottom: theme.spacing(1) }}>
        {WEEKDAY_LABELS.map((d, i) => (
          <View key={i} style={{ width: cell, marginRight: i < 6 ? gap : 0, alignItems: 'center' }}>
            <ThemedText variant="caption" color={theme.colors.textFaint}>
              {d}
            </ThemedText>
          </View>
        ))}
      </View>
      <Svg width={svgWidth} height={gridHeight}>
        {cells}
      </Svg>
      {/* Intensity legend */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing(1.5),
          marginTop: theme.spacing(3),
          alignSelf: 'flex-end',
        }}
      >
        <ThemedText variant="caption" color={theme.colors.textFaint}>
          Less
        </ThemedText>
        {[0, 0.33, 0.66, 1].map((t) => (
          <View
            key={t}
            style={{
              width: 12,
              height: 12,
              borderRadius: theme.radius.sm,
              backgroundColor: lerpHexColor(theme.colors.surfaceAlt, theme.colors.primary, t),
            }}
          />
        ))}
        <ThemedText variant="caption" color={theme.colors.textFaint}>
          More
        </ThemedText>
      </View>
    </View>
  );
}
