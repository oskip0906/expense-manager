/**
 * Budgets — set and track monthly spending caps.
 *
 * Layout: a month selector (defaults to the current month), a grid of
 * BudgetRing charts for every category that has a cap (actual spend vs. cap),
 * an overall budget-vs-actual summary, and an inline editor with a numeric
 * input per active category plus an optional total cap. Saving persists via
 * useSetBudget with { perCategory, totalCap }.
 *
 * Money convention (Plaid): amount > 0 = spend. Actual per-category spend comes
 * from useMonthStats(month).perCategory[].total, which already sums positives.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { toMonthKey, type Category } from '@expense/shared';
import {
  useCategories,
  useBudget,
  useSetBudget,
  useMonthStats,
  type CategoryStat,
} from '@/hooks';
import {
  Screen,
  Card,
  Button,
  ThemedText,
  Money,
  ProgressBar,
  SectionHeader,
  Divider,
  EmptyState,
  LoadingState,
  formatMoney,
} from '@/components/ui';
import { BudgetRing } from '@/components/charts';
import { theme, fallbackCategoryColor } from '@/theme';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

/** Shift a `YYYY-MM` key by `delta` months, staying calendar-correct. */
function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  // Day 15 at UTC-noon avoids any tz/DST edge landing in an adjacent month.
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 15, 12, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Human month label, e.g. "July 2026". */
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15, 12)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A parsed, validated cap value keyed by category. Empty string clears the cap. */
type Drafts = Record<string, string>;

function catColor(cat: Category): string {
  return cat.color || fallbackCategoryColor(cat.categoryId);
}

export default function BudgetsScreen() {
  const currentMonth = toMonthKey(new Date(), TZ);
  const [month, setMonth] = useState<string>(currentMonth);

  const categoriesQ = useCategories();
  const budgetQ = useBudget(month);
  const statsQ = useMonthStats(month);
  const setBudget = useSetBudget(month);

  // Editor drafts, keyed by categoryId, plus the optional overall cap. The
  // editor is opened lazily and seeded from the persisted budget on open so we
  // never fight the query cache with a controlled/uncontrolled toggle.
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [totalDraft, setTotalDraft] = useState<string>('');

  // Active (non-archived) categories drive the editor rows. Sorted by name for
  // a stable order (useCategories already orders by name, but be defensive).
  const activeCategories = useMemo<Category[]>(
    () =>
      (categoriesQ.data ?? [])
        .filter((c) => !c.isArchived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [categoriesQ.data],
  );

  const stats = statsQ.data;

  // Actual spend by categoryId this month (positive amounts summed by stats).
  const spendByCat = useMemo<Record<string, CategoryStat>>(() => {
    const map: Record<string, CategoryStat> = {};
    for (const cs of stats?.perCategory ?? []) map[cs.categoryId] = cs;
    return map;
  }, [stats]);

  const budget = budgetQ.data;

  // Categories that currently have a positive cap set — these get a ring.
  const cappedCategories = useMemo(() => {
    const caps = budget?.perCategory ?? {};
    return activeCategories
      .filter((c) => (caps[c.categoryId] ?? 0) > 0)
      .map((c) => {
        const cap = caps[c.categoryId]!;
        const actual = spendByCat[c.categoryId]?.total ?? 0;
        return {
          category: c,
          cap,
          actual,
          consumedPct: cap > 0 ? actual / cap : 0,
        };
      })
      .sort((a, b) => b.consumedPct - a.consumedPct);
  }, [activeCategories, budget, spendByCat]);

  // Overall actual vs. cap. If no explicit totalCap, fall back to the sum of
  // per-category caps so the summary is still meaningful.
  const sumOfCaps = useMemo(
    () => Object.values(budget?.perCategory ?? {}).reduce((s, v) => s + (v > 0 ? v : 0), 0),
    [budget],
  );
  const effectiveTotalCap = budget?.totalCap ?? (sumOfCaps > 0 ? sumOfCaps : null);
  const totalActual = stats?.monthToDateSpend ?? 0;
  const totalPct = effectiveTotalCap && effectiveTotalCap > 0 ? totalActual / effectiveTotalCap : null;

  const isLoading = categoriesQ.isLoading || statsQ.isLoading;

  function openEditor() {
    const caps = budget?.perCategory ?? {};
    const seeded: Drafts = {};
    for (const c of activeCategories) {
      const v = caps[c.categoryId];
      seeded[c.categoryId] = v && v > 0 ? String(v) : '';
    }
    setDrafts(seeded);
    setTotalDraft(budget?.totalCap != null ? String(budget.totalCap) : '');
    setEditing(true);
  }

  function cancelEditor() {
    setEditing(false);
  }

  function setDraft(categoryId: string, text: string) {
    // Keep only digits and a single decimal point so the input can't hold
    // negatives or junk; validation below still guards the parsed value.
    const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setDrafts((prev) => ({ ...prev, [categoryId]: cleaned }));
  }

  function parseCap(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === '') return null; // cleared / unset
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  // A draft is invalid only when it's non-empty and doesn't parse to a number >= 0.
  const invalidCount = useMemo(() => {
    let bad = 0;
    for (const c of activeCategories) {
      const raw = drafts[c.categoryId] ?? '';
      if (raw.trim() !== '' && parseCap(raw) === null) bad += 1;
    }
    if (totalDraft.trim() !== '' && parseCap(totalDraft) === null) bad += 1;
    return bad;
  }, [drafts, totalDraft, activeCategories]);

  async function save() {
    if (invalidCount > 0) return;
    const perCategory: Record<string, number> = {};
    for (const c of activeCategories) {
      const n = parseCap(drafts[c.categoryId] ?? '');
      if (n != null && n > 0) perCategory[c.categoryId] = n; // 0 / empty clears the cap
    }
    const totalCap = parseCap(totalDraft); // null when cleared
    await setBudget.mutateAsync({ perCategory, totalCap });
    setEditing(false);
  }

  if (isLoading) {
    return (
      <Screen>
        <MonthSelector month={month} currentMonth={currentMonth} onChange={setMonth} />
        <LoadingState />
      </Screen>
    );
  }

  if (activeCategories.length === 0) {
    return (
      <Screen>
        <MonthSelector month={month} currentMonth={currentMonth} onChange={setMonth} />
        <EmptyState
          icon="wallet-outline"
          title="No categories yet"
          subtitle="Categories are created as your transactions get classified. Once you have some, set a monthly cap for each here."
        />
      </Screen>
    );
  }

  return (
    <Screen refreshing={statsQ.isRefetching} onRefresh={statsQ.refetch}>
      <MonthSelector month={month} currentMonth={currentMonth} onChange={setMonth} />

      {/* Overall budget vs. actual */}
      <Card style={styles.overallCard}>
        <View style={styles.overallHeader}>
          <ThemedText variant="label" color={theme.colors.textMuted} weight="semibold">
            {effectiveTotalCap != null ? 'Overall spend vs. budget' : 'Overall spend'}
          </ThemedText>
          {budget?.totalCap == null && effectiveTotalCap != null ? (
            <ThemedText variant="caption" color={theme.colors.textFaint}>
              from category caps
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.overallAmounts}>
          <Money amount={totalActual} variant="title" weight="bold" colorBySign={false} />
          {effectiveTotalCap != null ? (
            <ThemedText variant="body" color={theme.colors.textMuted}>
              {` / ${formatMoney(effectiveTotalCap)}`}
            </ThemedText>
          ) : null}
        </View>
        {totalPct != null ? (
          <>
            <ProgressBar pct={totalPct} height={10} />
            <View style={styles.overallFooter}>
              <ThemedText
                variant="caption"
                weight="semibold"
                color={totalPct > 1 ? theme.colors.danger : theme.colors.textMuted}
              >
                {`${Math.round(totalPct * 100)}% used`}
              </ThemedText>
              <ThemedText variant="caption" color={theme.colors.textMuted}>
                {totalPct > 1
                  ? `${formatMoney(totalActual - effectiveTotalCap!)} over`
                  : `${formatMoney(effectiveTotalCap! - totalActual)} left`}
              </ThemedText>
            </View>
          </>
        ) : (
          <ThemedText variant="caption" color={theme.colors.textFaint}>
            Set caps below to track a budget for {monthLabel(month)}.
          </ThemedText>
        )}
      </Card>

      {/* Per-category rings for capped categories */}
      <SectionHeader
        title="By category"
        actionLabel={editing ? undefined : 'Edit budget'}
        onAction={editing ? undefined : openEditor}
      />
      {cappedCategories.length === 0 ? (
        <Card>
          <ThemedText color={theme.colors.textMuted}>
            No category caps set for {monthLabel(month)}.
          </ThemedText>
          {!editing ? (
            <Button
              title="Set caps"
              icon="options-outline"
              variant="ghost"
              onPress={openEditor}
              style={{ marginTop: theme.spacing(3) }}
            />
          ) : null}
        </Card>
      ) : (
        <View style={styles.ringGrid}>
          {cappedCategories.map(({ category, cap, actual, consumedPct }) => (
            <View key={category.categoryId} style={styles.ringCell}>
              <BudgetRing
                label={category.name}
                consumedPct={consumedPct}
                color={catColor(category)}
                amount={actual}
                cap={cap}
              />
            </View>
          ))}
        </View>
      )}

      {/* Editor */}
      {editing ? (
        <Card style={{ marginTop: theme.spacing(4) }}>
          <ThemedText variant="heading" weight="bold">
            Edit {monthLabel(month)} budget
          </ThemedText>
          <ThemedText variant="caption" color={theme.colors.textMuted} style={{ marginTop: theme.spacing(1) }}>
            Set a monthly cap per category. Leave blank or 0 to remove a cap.
          </ThemedText>

          <Divider />

          {activeCategories.map((cat) => {
            const raw = drafts[cat.categoryId] ?? '';
            const invalid = raw.trim() !== '' && parseCap(raw) === null;
            const actual = spendByCat[cat.categoryId]?.total ?? 0;
            return (
              <View key={cat.categoryId} style={styles.editorRow}>
                <View style={styles.editorLabel}>
                  <View style={[styles.dot, { backgroundColor: catColor(cat) }]} />
                  <View style={{ flexShrink: 1 }}>
                    <ThemedText weight="medium" numberOfLines={1}>
                      {cat.name}
                    </ThemedText>
                    <ThemedText variant="caption" color={theme.colors.textFaint}>
                      {`spent ${formatMoney(actual)}`}
                    </ThemedText>
                  </View>
                </View>
                <CapInput
                  value={raw}
                  invalid={invalid}
                  onChangeText={(t) => setDraft(cat.categoryId, t)}
                />
              </View>
            );
          })}

          <Divider />

          <View style={styles.editorRow}>
            <View style={styles.editorLabel}>
              <Ionicons name="wallet-outline" size={18} color={theme.colors.textMuted} />
              <View style={{ flexShrink: 1 }}>
                <ThemedText weight="semibold">Total cap</ThemedText>
                <ThemedText variant="caption" color={theme.colors.textFaint}>
                  optional overall limit
                </ThemedText>
              </View>
            </View>
            <CapInput
              value={totalDraft}
              invalid={totalDraft.trim() !== '' && parseCap(totalDraft) === null}
              onChangeText={(t) =>
                setTotalDraft(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))
              }
            />
          </View>

          {invalidCount > 0 ? (
            <ThemedText
              variant="caption"
              color={theme.colors.danger}
              style={{ marginTop: theme.spacing(2) }}
            >
              Enter amounts of 0 or more.
            </ThemedText>
          ) : null}

          <View style={styles.editorActions}>
            <Button title="Cancel" variant="ghost" onPress={cancelEditor} style={{ flex: 1 }} />
            <Button
              title="Save"
              onPress={save}
              loading={setBudget.isPending}
              disabled={invalidCount > 0}
              style={{ flex: 1 }}
            />
          </View>

          {setBudget.isError ? (
            <ThemedText
              variant="caption"
              color={theme.colors.danger}
              style={{ marginTop: theme.spacing(2) }}
            >
              Could not save budget. Please try again.
            </ThemedText>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

// --- Helper components (kept local to avoid name collisions) --------------

function MonthSelector({
  month,
  currentMonth,
  onChange,
}: {
  month: string;
  currentMonth: string;
  onChange: (m: string) => void;
}) {
  const atCurrent = month >= currentMonth;
  return (
    <View style={styles.monthBar}>
      <StepButton icon="chevron-back" onPress={() => onChange(shiftMonth(month, -1))} />
      <View style={styles.monthLabelWrap}>
        <ThemedText variant="heading" weight="bold">
          {monthLabel(month)}
        </ThemedText>
        {month !== currentMonth ? (
          <Pressable onPress={() => onChange(currentMonth)} hitSlop={8}>
            <ThemedText variant="caption" weight="semibold" color={theme.colors.primary}>
              Jump to current
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      <StepButton
        icon="chevron-forward"
        disabled={atCurrent}
        onPress={() => !atCurrent && onChange(shiftMonth(month, 1))}
      />
    </View>
  );
}

function StepButton({
  icon,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.stepButton,
        { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={22} color={theme.colors.text} />
    </Pressable>
  );
}

function CapInput({
  value,
  invalid,
  onChangeText,
}: {
  value: string;
  invalid: boolean;
  onChangeText: (t: string) => void;
}) {
  return (
    <View
      style={[
        styles.capInputWrap,
        { borderColor: invalid ? theme.colors.danger : theme.colors.border },
      ]}
    >
      <ThemedText variant="body" color={theme.colors.textFaint}>
        $
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        inputMode="decimal"
        placeholder="0"
        placeholderTextColor={theme.colors.textFaint}
        selectionColor={theme.colors.primary}
        style={styles.capInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  monthLabelWrap: { alignItems: 'center', flex: 1 },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overallCard: { marginTop: theme.spacing(2) },
  overallHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overallAmounts: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(3),
  },
  overallFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing(2),
  },
  ringGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  ringCell: {
    width: '48%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing(3),
    paddingVertical: theme.spacing(1),
  },
  editorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  editorLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    flex: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  capInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 110,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    backgroundColor: theme.colors.surfaceAlt,
  },
  capInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.font.body,
    fontWeight: theme.weight.semibold,
    padding: 0,
    textAlign: 'right',
  },
  editorActions: {
    flexDirection: 'row',
    gap: theme.spacing(3),
    marginTop: theme.spacing(4),
  },
});
