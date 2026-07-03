/**
 * Internal chart helpers shared across the chart components in this folder.
 * NOT exported from the barrel — these are private to '@/components/charts'.
 */
import React from 'react';
import { Dimensions, View } from 'react-native';
import { theme } from '@/theme';
import { ThemedText } from '@/components/ui';

/**
 * Default responsive chart width. Screens render charts inside padded Cards
 * (Screen pads `spacing(4)` each side, Card pads `spacing(4)` each side), so we
 * subtract that horizontal chrome from the window width.
 */
export function chartWidth(extraInset = 0): number {
  const screenPad = theme.spacing(4) * 2; // Screen horizontal padding
  const cardPad = theme.spacing(4) * 2; // Card horizontal padding
  const w = Dimensions.get('window').width - screenPad - cardPad - extraInset;
  return Math.max(200, Math.round(w));
}

/** Small muted empty-state used by every chart when data is empty/all-zero. */
export function ChartEmpty({ label }: { label: string }) {
  return (
    <View style={{ paddingVertical: theme.spacing(8), alignItems: 'center' }}>
      <ThemedText variant="label" color={theme.colors.textFaint} style={{ textAlign: 'center' }}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * Linear interpolation between two hex colors (#rrggbb). `t` is clamped 0..1.
 * Used by the calendar heatmap to shade days between surfaceAlt and primary.
 */
export function lerpHexColor(from: string, to: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const r = Math.round(a.r + (b.r - a.r) * clamped);
  const g = Math.round(a.g + (b.g - a.g) * clamped);
  const bl = Math.round(a.b + (b.b - a.b) * clamped);
  return rgbToHex(r, g, bl);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const int = parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** Compact currency-ish axis label, e.g. 1234 -> "$1.2k". */
export function compactAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}
