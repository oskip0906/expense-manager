/**
 * Build the day's InsightTips from a StatsSnapshot.
 *
 * Guardrails first: we ONLY call Gemini (and only produce tips) when something
 * noteworthy fired:
 *   - a category's wowDeltaPct > PIPELINE.spikeThresholdPct (a spending spike), OR
 *   - a category's consumedPct > PIPELINE.budgetWarnPct (approaching/over cap), OR
 *   - projectedMonthEndSpend > totalCap (on pace to blow the overall budget).
 * If nothing fires we return [] and skip the model call entirely (cost + noise).
 *
 * When something fires we feed a COMPACT text summary (only the triggering
 * facts) to the model, cap at PIPELINE.maxTipsPerDay, map each tip's
 * categoryName back to a categoryId, and assign stable ids.
 */
import {
  PIPELINE,
  paths,
  type Budget,
  type InsightTip,
  type StatsSnapshot,
} from '@expense/shared';
import { db } from '../admin';
import { suggest as geminiSuggest } from './gemini';

interface Trigger {
  kind: 'spike' | 'budget' | 'projection';
  categoryName: string | null;
  detail: string;
}

export async function buildSuggestions(
  uid: string,
  stats: StatsSnapshot,
): Promise<InsightTip[]> {
  const budgetSnap = await db.doc(paths.budget(uid, stats.month)).get();
  const totalCap = budgetSnap.exists
    ? ((budgetSnap.data() as Budget).totalCap ?? null)
    : null;

  const triggers: Trigger[] = [];

  for (const c of stats.perCategory) {
    if (c.wowDeltaPct !== null && c.wowDeltaPct > PIPELINE.spikeThresholdPct) {
      triggers.push({
        kind: 'spike',
        categoryName: c.categoryName,
        detail: `${c.categoryName} spend is up ${formatSpct(c.wowDeltaPct)} week-over-week (now ${money(
          c.total,
        )} this month).`,
      });
    }
    if (c.consumedPct !== null && c.consumedPct > PIPELINE.budgetWarnPct) {
      triggers.push({
        kind: 'budget',
        categoryName: c.categoryName,
        detail: `${c.categoryName} has used ${formatSpct(c.consumedPct)} of its ${money(
          c.budget ?? 0,
        )} budget (${money(c.total)} spent).`,
      });
    }
  }

  if (totalCap !== null && totalCap > 0 && stats.projectedMonthEndSpend > totalCap) {
    triggers.push({
      kind: 'projection',
      categoryName: null,
      detail: `Projected month-end spend is ${money(
        stats.projectedMonthEndSpend,
      )}, over the overall budget of ${money(totalCap)} (${money(
        stats.monthToDateSpend,
      )} so far).`,
    });
  }

  if (triggers.length === 0) return [];

  // --- Compact summary: only the triggering facts + minimal context.
  const summaryLines = [
    `Month: ${stats.month}. Spent so far: ${money(stats.monthToDateSpend)}.`,
    stats.momDeltaPct !== null
      ? `Month-over-month vs same day last month: ${formatSpct(stats.momDeltaPct)}.`
      : null,
    `Projected month-end: ${money(stats.projectedMonthEndSpend)}${
      totalCap ? ` (overall budget ${money(totalCap)})` : ''
    }.`,
    '',
    'Noteworthy signals:',
    ...triggers.map((t) => `- ${t.detail}`),
  ].filter((l): l is string => l !== null);

  const response = await geminiSuggest(summaryLines.join('\n'));

  // Normalize names on both sides so a tip's categoryName resolves even when the
  // model differs in casing/whitespace from the stored category name.
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const nameToId = new Map<string, string>();
  for (const c of stats.perCategory) {
    if (c.categoryId !== '__uncategorized__') nameToId.set(norm(c.categoryName), c.categoryId);
  }

  const tips: InsightTip[] = response.tips.slice(0, PIPELINE.maxTipsPerDay).map((t, i) => ({
    id: `${stats.month}-${i}`,
    title: t.title,
    body: t.body,
    categoryId: t.categoryName ? (nameToId.get(norm(t.categoryName)) ?? null) : null,
    severity: t.severity,
  }));

  return tips;
}

// --- Tiny local formatters (kept dependency-free; UI has its own formatMoney).
function money(n: number): string {
  return `$${(Math.round(n * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatSpct(fraction: number): string {
  const sign = fraction >= 0 ? '+' : '';
  return `${sign}${Math.round(fraction * 100)}%`;
}
