/**
 * Single source of truth for the app's visual language. The app ships a
 * cohesive dark "fintech" palette. Screens and charts import `theme` directly
 * (never hardcode colors), so restyling is a one-file change.
 */
import { CATEGORY_PALETTE } from '@expense/shared';

export const theme = {
  colors: {
    bg: '#0B1220',
    surface: '#131C2E',
    surfaceAlt: '#1B2740',
    border: '#26324B',
    text: '#F4F7FB',
    textMuted: '#93A1B8',
    textFaint: '#5D6B84',
    primary: '#6366F1',
    primaryMuted: '#3B3F86',
    success: '#22C55E',
    danger: '#EF4444',
    warn: '#F59E0B',
    /** Spend (money out) is rendered danger-ish; income (money in) success. */
    spend: '#F4F7FB',
    income: '#22C55E',
    overlay: 'rgba(3, 7, 18, 0.6)',
  },
  spacing: (n: number) => n * 4,
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    pill: 999,
  },
  font: {
    display: 34,
    title: 24,
    heading: 18,
    body: 15,
    label: 13,
    caption: 11,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

export type Theme = typeof theme;

/** Deterministic color for a category id when it has no explicit color set. */
export function fallbackCategoryColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % CATEGORY_PALETTE.length;
  return CATEGORY_PALETTE[idx]!;
}
