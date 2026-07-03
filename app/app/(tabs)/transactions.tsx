/**
 * Transactions (Activity tab).
 *
 * A paginated, filterable feed of the user's transactions. The server-side feed
 * (useTransactionsFeed) applies the date range plus at most one equality filter
 * that our composite indexes cover; free-text search and any secondary filters
 * are then narrowed client-side via applyClientFilters over the loaded pages.
 *
 * Rendered in a plain FlatList inside a SafeAreaView (NOT the shared Screen's
 * ScrollView — nesting a virtualized list in a ScrollView breaks recycling).
 *
 * Interactions:
 *  - Search box filters by name.
 *  - Filter row: date-range preset, category, account, pending toggle.
 *  - Tap a row -> edit modal: recategorize (locks the category), edit notes,
 *    and delete (manual transactions only).
 *  - FAB (+) -> add-manual-transaction modal.
 *
 * Money sign convention (Plaid): amount > 0 = spend, amount < 0 = income.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  toDateKey,
  type Account,
  type Category,
  type Transaction,
  type TransactionEdit,
} from '@expense/shared';
import {
  useTransactionsFeed,
  applyClientFilters,
  useCategories,
  useAccounts,
  useUpdateTransaction,
  useAddManualTransaction,
  useDeleteTransaction,
  type TxnFilters,
} from '@/hooks';
import {
  ThemedText,
  Card,
  Button,
  Money,
  Badge,
  Divider,
  EmptyState,
  LoadingState,
  formatMoney,
} from '@/components/ui';
import { theme, fallbackCategoryColor } from '@/theme';

// Device timezone for formatting stored UTC timestamps to local calendar dates.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// --- Date-range presets -----------------------------------------------------

type DatePreset = 'thisMonth' | 'last30' | 'all';

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'last30', label: 'Last 30d' },
  { key: 'all', label: 'All' },
];

function presetRange(preset: DatePreset): { start?: Date; end?: Date } {
  if (preset === 'all') return {};
  const now = new Date();
  if (preset === 'thisMonth') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { start };
  }
  // last30
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  return { start };
}

// --- Small date helpers ------------------------------------------------------

function formatRowDate(t: Transaction): string {
  const d = t.date.toDate();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Today's calendar date as YYYY-MM-DD in the device timezone. */
function todayDateKey(): string {
  return toDateKey(new Date(), TZ);
}

// ============================================================================
// Screen
// ============================================================================

export default function TransactionsScreen() {
  const categoriesQuery = useCategories();
  const accountsQuery = useAccounts();

  // Deep-link support: Insights taps navigate here with ?categoryId=...
  const params = useLocalSearchParams<{ categoryId?: string }>();

  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<DatePreset>(params.categoryId ? 'all' : 'thisMonth');
  const [categoryId, setCategoryId] = useState<string | undefined>(params.categoryId);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [pendingOnly, setPendingOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // When a categoryId param arrives (or changes) while mounted, focus that
  // category across all time.
  useEffect(() => {
    if (params.categoryId) {
      setCategoryId(params.categoryId);
      setPreset('all');
    }
  }, [params.categoryId]);

  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);

  const categories = useMemo(
    () => (categoriesQuery.data ?? []).filter((c) => !c.isArchived),
    [categoriesQuery.data],
  );
  const accounts = accountsQuery.data ?? [];

  // Server-side filters (range + one equality). Search stays client-side.
  const filters = useMemo<TxnFilters>(() => {
    const range = presetRange(preset);
    return {
      ...range,
      categoryId,
      accountId,
      pending: pendingOnly ? true : undefined,
      search: search.trim() || undefined,
    };
  }, [preset, categoryId, accountId, pendingOnly, search]);

  const feed = useTransactionsFeed(filters);

  // Flatten loaded pages, then narrow with the client-side filters (search +
  // any secondary equality the server couldn't apply).
  const items = useMemo(() => {
    const flat = (feed.data?.pages ?? []).flatMap((p) => p.items);
    return applyClientFilters(flat, filters);
  }, [feed.data, filters]);

  const activeFilterCount =
    (categoryId ? 1 : 0) + (accountId ? 1 : 0) + (pendingOnly ? 1 : 0) + (preset !== 'thisMonth' ? 1 : 0);

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categoriesQuery.data ?? []) map.set(c.categoryId, c);
    return map;
  }, [categoriesQuery.data]);

  const showInitialLoading = feed.isLoading && items.length === 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText variant="title" weight="bold">
          Activity
        </ThemedText>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={theme.colors.textFaint} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search transactions"
          placeholderTextColor={theme.colors.textFaint}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={theme.colors.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {/* Filter bar: date presets inline + a "Filters" chip that opens the sheet */}
      <View style={styles.filterBar}>
        <View style={styles.presetRow}>
          {DATE_PRESETS.map((p) => {
            const active = preset === p.key;
            return (
              <Pressable
                key={p.key}
                onPress={() => setPreset(p.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <ThemedText
                  variant="label"
                  weight="semibold"
                  color={active ? '#fff' : theme.colors.textMuted}
                >
                  {p.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => setFiltersOpen(true)} style={styles.filterButton} hitSlop={8}>
          <Ionicons name="options-outline" size={16} color={theme.colors.text} />
          <ThemedText variant="label" weight="semibold">
            Filters
          </ThemedText>
          {activeFilterCount > 0 ? (
            <View style={styles.filterCountDot}>
              <ThemedText variant="caption" weight="bold" color="#fff">
                {activeFilterCount}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* List */}
      {showInitialLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(t) => t.plaidTxnId}
          renderItem={({ item }) => (
            <TxnRow
              txn={item}
              category={item.categoryId ? categoryById.get(item.categoryId) : undefined}
              onPress={() => setEditing(item)}
            />
          )}
          ItemSeparatorComponent={ThinDivider}
          contentContainerStyle={
            items.length === 0
              ? styles.listEmptyContainer
              : { paddingBottom: theme.spacing(24) }
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshing={feed.isRefetching && !feed.isFetchingNextPage}
          onRefresh={() => feed.refetch()}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
          }}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="No transactions"
              subtitle={
                search || activeFilterCount > 0
                  ? 'Nothing matches your current filters. Try widening the date range or clearing filters.'
                  : 'Linked account activity will appear here. You can also add a manual entry.'
              }
              actionLabel="Add transaction"
              onAction={() => setAdding(true)}
            />
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color={theme.colors.textMuted} />
              </View>
            ) : null
          }
        />
      )}

      {/* FAB */}
      <Pressable
        onPress={() => setAdding(true)}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        accessibilityLabel="Add manual transaction"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>

      {/* Filter sheet */}
      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        categories={categories}
        accounts={accounts}
        categoryId={categoryId}
        accountId={accountId}
        pendingOnly={pendingOnly}
        onChangeCategory={setCategoryId}
        onChangeAccount={setAccountId}
        onChangePending={setPendingOnly}
        onClear={() => {
          setCategoryId(undefined);
          setAccountId(undefined);
          setPendingOnly(false);
        }}
      />

      {/* Edit modal */}
      {editing ? (
        <EditTxnModal
          txn={editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {/* Add manual modal */}
      {adding ? (
        <AddTxnModal
          categories={categories}
          accounts={accounts}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ============================================================================
// Row
// ============================================================================

function ThinDivider() {
  return <View style={styles.rowDivider} />;
}

function TxnRow({
  txn,
  category,
  onPress,
}: {
  txn: Transaction;
  category?: Category;
  onPress: () => void;
}) {
  const catName = txn.categoryName ?? category?.name ?? 'Uncategorized';
  const catColor = category?.color ?? fallbackCategoryColor(txn.categoryId ?? catName);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={styles.rowMain}>
        <ThemedText weight="semibold" numberOfLines={1}>
          {txn.name}
        </ThemedText>
        <View style={styles.rowMeta}>
          <ThemedText variant="caption" color={theme.colors.textFaint}>
            {formatRowDate(txn)}
          </ThemedText>
          {txn.merchantName && txn.merchantName !== txn.name ? (
            <>
              <ThemedText variant="caption" color={theme.colors.textFaint}>
                {'·'}
              </ThemedText>
              <ThemedText variant="caption" color={theme.colors.textFaint} numberOfLines={1}>
                {txn.merchantName}
              </ThemedText>
            </>
          ) : null}
          {txn.pending ? (
            <>
              <ThemedText variant="caption" color={theme.colors.textFaint}>
                {'·'}
              </ThemedText>
              <ThemedText variant="caption" color={theme.colors.warn}>
                Pending
              </ThemedText>
            </>
          ) : null}
        </View>
        <View style={styles.rowBadgeWrap}>
          <Badge label={catName} color={catColor} />
        </View>
      </View>
      <View style={styles.rowAmount}>
        <Money amount={txn.amount} currency={txn.isoCurrencyCode ?? 'USD'} />
      </View>
    </Pressable>
  );
}

// ============================================================================
// Filter sheet
// ============================================================================

function FilterSheet({
  visible,
  onClose,
  categories,
  accounts,
  categoryId,
  accountId,
  pendingOnly,
  onChangeCategory,
  onChangeAccount,
  onChangePending,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  categories: Category[];
  accounts: Account[];
  categoryId?: string;
  accountId?: string;
  pendingOnly: boolean;
  onChangeCategory: (id: string | undefined) => void;
  onChangeAccount: (id: string | undefined) => void;
  onChangePending: (v: boolean) => void;
  onClear: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <ThemedText variant="heading" weight="bold">
              Filters
            </ThemedText>
            <Pressable onPress={onClear} hitSlop={8}>
              <ThemedText variant="label" weight="semibold" color={theme.colors.primary}>
                Clear all
              </ThemedText>
            </Pressable>
          </View>

          <ThemedText variant="label" weight="semibold" color={theme.colors.textMuted}>
            Category
          </ThemedText>
          <View style={styles.wrapChips}>
            <SelectChip
              label="All"
              active={!categoryId}
              onPress={() => onChangeCategory(undefined)}
            />
            {categories.map((c) => (
              <SelectChip
                key={c.categoryId}
                label={c.name}
                color={c.color}
                active={categoryId === c.categoryId}
                onPress={() => onChangeCategory(c.categoryId)}
              />
            ))}
          </View>

          <ThemedText
            variant="label"
            weight="semibold"
            color={theme.colors.textMuted}
            style={{ marginTop: theme.spacing(4) }}
          >
            Account
          </ThemedText>
          <View style={styles.wrapChips}>
            <SelectChip
              label="All"
              active={!accountId}
              onPress={() => onChangeAccount(undefined)}
            />
            {accounts.map((a) => (
              <SelectChip
                key={a.accountId}
                label={accountLabel(a)}
                active={accountId === a.accountId}
                onPress={() => onChangeAccount(a.accountId)}
              />
            ))}
          </View>

          <Pressable
            style={styles.toggleRow}
            onPress={() => onChangePending(!pendingOnly)}
          >
            <ThemedText weight="medium">Pending only</ThemedText>
            <View style={[styles.toggleTrack, pendingOnly && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, pendingOnly && styles.toggleThumbOn]} />
            </View>
          </Pressable>

          <Button title="Show results" onPress={onClose} style={{ marginTop: theme.spacing(4) }} />
        </View>
      </View>
    </Modal>
  );
}

function SelectChip({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active: boolean;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.selectChip,
        active && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
      ]}
    >
      {color ? (
        <View style={[styles.chipDot, { backgroundColor: color }]} />
      ) : null}
      <ThemedText
        variant="label"
        weight="semibold"
        color={active ? '#fff' : theme.colors.text}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

function accountLabel(a: Account): string {
  return a.mask ? `${a.name} ··${a.mask}` : a.name;
}

// ============================================================================
// Edit modal (recategorize / notes / delete)
// ============================================================================

function EditTxnModal({
  txn,
  categories,
  onClose,
}: {
  txn: Transaction;
  categories: Category[];
  onClose: () => void;
}) {
  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();

  const [selectedCat, setSelectedCat] = useState<string | null>(txn.categoryId);
  const [notes, setNotes] = useState(txn.notes ?? '');

  const catName = (id: string | null): string | null =>
    id ? categories.find((c) => c.categoryId === id)?.name ?? txn.categoryName ?? null : null;

  const dirty =
    selectedCat !== txn.categoryId || notes.trim() !== (txn.notes ?? '').trim();

  const onSave = async () => {
    const edit: TransactionEdit = {
      notes: notes.trim() ? notes.trim() : null,
    };
    // Only touch category when it changed; changing it always locks it so the
    // nightly classifier won't overwrite the user's choice.
    if (selectedCat !== txn.categoryId) {
      edit.categoryId = selectedCat;
      edit.categoryName = catName(selectedCat);
      edit.manualCategoryLock = true;
    }
    await update.mutateAsync({ txnId: txn.plaidTxnId, edit });
    onClose();
  };

  const onDelete = async () => {
    await remove.mutateAsync(txn.plaidTxnId);
    onClose();
  };

  const busy = update.isPending || remove.isPending;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />

          <ThemedText variant="heading" weight="bold" numberOfLines={2}>
            {txn.name}
          </ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2), marginTop: theme.spacing(1) }}>
            <ThemedText variant="label" color={theme.colors.textMuted}>
              {formatRowDate(txn)}
            </ThemedText>
            <Money amount={txn.amount} currency={txn.isoCurrencyCode ?? 'USD'} variant="label" />
            {txn.isManual ? <Badge label="Manual" color={theme.colors.primary} /> : null}
          </View>

          <Divider />

          <ThemedText variant="label" weight="semibold" color={theme.colors.textMuted}>
            Category
          </ThemedText>
          <View style={styles.wrapChips}>
            {categories.map((c) => (
              <SelectChip
                key={c.categoryId}
                label={c.name}
                color={c.color}
                active={selectedCat === c.categoryId}
                onPress={() => setSelectedCat(c.categoryId)}
              />
            ))}
          </View>

          <ThemedText
            variant="label"
            weight="semibold"
            color={theme.colors.textMuted}
            style={{ marginTop: theme.spacing(4) }}
          >
            Notes
          </ThemedText>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Add a note"
            placeholderTextColor={theme.colors.textFaint}
            style={styles.notesInput}
            multiline
            maxLength={500}
          />

          <Button
            title="Save"
            onPress={onSave}
            loading={update.isPending}
            disabled={busy || !dirty}
            style={{ marginTop: theme.spacing(4) }}
          />
          {txn.isManual ? (
            <Button
              title="Delete transaction"
              variant="danger"
              onPress={onDelete}
              loading={remove.isPending}
              disabled={busy}
              icon="trash-outline"
              style={{ marginTop: theme.spacing(2) }}
            />
          ) : null}
          <Button
            title="Cancel"
            variant="ghost"
            onPress={onClose}
            disabled={busy}
            style={{ marginTop: theme.spacing(2) }}
          />
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// Add manual transaction modal
// ============================================================================

function AddTxnModal({
  categories,
  accounts,
  onClose,
}: {
  categories: Category[];
  accounts: Account[];
  onClose: () => void;
}) {
  const add = useAddManualTransaction();

  const [accountId, setAccountId] = useState<string | undefined>(accounts[0]?.accountId);
  const [dateStr, setDateStr] = useState(todayDateKey());
  const [amountStr, setAmountStr] = useState('');
  const [isIncome, setIsIncome] = useState(false);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const parsedAmount = parseAmount(amountStr);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(new Date(dateStr).getTime());
  const canSave =
    !!accountId && name.trim().length > 0 && parsedAmount != null && parsedAmount > 0 && dateValid;

  const onSave = async () => {
    if (!canSave || accountId == null || parsedAmount == null) return;
    // Spend is positive per Plaid convention; income is negative.
    const signed = isIncome ? -parsedAmount : parsedAmount;
    const cat = categoryId ? categories.find((c) => c.categoryId === categoryId) : undefined;
    await add.mutateAsync({
      accountId,
      date: dateStr,
      amount: signed,
      name: name.trim(),
      categoryId,
      categoryName: cat?.name ?? null,
      notes: notes.trim() ? notes.trim() : null,
    });
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <ThemedText variant="heading" weight="bold">
            Add transaction
          </ThemedText>

          {accounts.length === 0 ? (
            <Card style={{ marginTop: theme.spacing(3) }}>
              <ThemedText color={theme.colors.textMuted}>
                Link a bank account first, or add one from Settings, to record manual transactions.
              </ThemedText>
            </Card>
          ) : (
            <>
              <FieldLabel>Account</FieldLabel>
              <View style={styles.wrapChips}>
                {accounts.map((a) => (
                  <SelectChip
                    key={a.accountId}
                    label={accountLabel(a)}
                    active={accountId === a.accountId}
                    onPress={() => setAccountId(a.accountId)}
                  />
                ))}
              </View>

              <FieldLabel>Description</FieldLabel>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Coffee at Blue Bottle"
                placeholderTextColor={theme.colors.textFaint}
                style={styles.textField}
                maxLength={140}
              />

              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <FieldLabel>Amount</FieldLabel>
                  <TextInput
                    value={amountStr}
                    onChangeText={setAmountStr}
                    placeholder="0.00"
                    placeholderTextColor={theme.colors.textFaint}
                    style={styles.textField}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.col}>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput
                    value={dateStr}
                    onChangeText={setDateStr}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.colors.textFaint}
                    style={styles.textField}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <FieldLabel>Type</FieldLabel>
              <View style={styles.presetRow}>
                <Pressable
                  onPress={() => setIsIncome(false)}
                  style={[styles.chip, !isIncome && styles.chipActive]}
                >
                  <ThemedText
                    variant="label"
                    weight="semibold"
                    color={!isIncome ? '#fff' : theme.colors.textMuted}
                  >
                    Spend
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setIsIncome(true)}
                  style={[styles.chip, isIncome && styles.chipActive]}
                >
                  <ThemedText
                    variant="label"
                    weight="semibold"
                    color={isIncome ? '#fff' : theme.colors.textMuted}
                  >
                    Income
                  </ThemedText>
                </Pressable>
              </View>

              <FieldLabel>Category</FieldLabel>
              <View style={styles.wrapChips}>
                <SelectChip
                  label="None"
                  active={!categoryId}
                  onPress={() => setCategoryId(null)}
                />
                {categories.map((c) => (
                  <SelectChip
                    key={c.categoryId}
                    label={c.name}
                    color={c.color}
                    active={categoryId === c.categoryId}
                    onPress={() => setCategoryId(c.categoryId)}
                  />
                ))}
              </View>

              <FieldLabel>Notes</FieldLabel>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Optional"
                placeholderTextColor={theme.colors.textFaint}
                style={styles.notesInput}
                multiline
                maxLength={500}
              />

              {amountStr.length > 0 && (parsedAmount == null || parsedAmount <= 0) ? (
                <ThemedText variant="caption" color={theme.colors.danger} style={{ marginTop: theme.spacing(2) }}>
                  Enter a positive amount.
                </ThemedText>
              ) : null}
              {!dateValid ? (
                <ThemedText variant="caption" color={theme.colors.danger} style={{ marginTop: theme.spacing(2) }}>
                  Use date format YYYY-MM-DD.
                </ThemedText>
              ) : null}

              {canSave && parsedAmount != null ? (
                <ThemedText
                  variant="caption"
                  color={theme.colors.textMuted}
                  style={{ marginTop: theme.spacing(2) }}
                >
                  Will record {isIncome ? 'income' : 'spend'} of {formatMoney(parsedAmount)}.
                </ThemedText>
              ) : null}

              <Button
                title="Add transaction"
                onPress={onSave}
                loading={add.isPending}
                disabled={!canSave || add.isPending}
                style={{ marginTop: theme.spacing(4) }}
              />
            </>
          )}

          <Button
            title="Cancel"
            variant="ghost"
            onPress={onClose}
            disabled={add.isPending}
            style={{ marginTop: theme.spacing(2) }}
          />
        </View>
      </View>
    </Modal>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <ThemedText
      variant="label"
      weight="semibold"
      color={theme.colors.textMuted}
      style={{ marginTop: theme.spacing(4), marginBottom: theme.spacing(2) }}
    >
      {children}
    </ThemedText>
  );
}

/** Parse a user-typed amount ("$12.50", "1,234.5") into a number, or null. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: theme.spacing(4),
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(2),
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    marginHorizontal: theme.spacing(4),
    paddingHorizontal: theme.spacing(3),
    height: 42,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.font.body,
    paddingVertical: 0,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
  },
  presetRow: { flexDirection: 'row', gap: theme.spacing(2) },
  chip: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1.5),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  filterCountDot: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    gap: theme.spacing(3),
  },
  rowMain: { flex: 1, gap: theme.spacing(1) },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1.5), flexWrap: 'wrap' },
  rowBadgeWrap: { marginTop: theme.spacing(0.5) },
  rowAmount: { alignItems: 'flex-end' },
  rowDivider: { height: 1, backgroundColor: theme.colors.border, marginLeft: theme.spacing(4) },
  listEmptyContainer: { flexGrow: 1, justifyContent: 'center' },
  footerLoading: { paddingVertical: theme.spacing(6) },
  fab: {
    position: 'absolute',
    right: theme.spacing(5),
    bottom: theme.spacing(6),
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  // Modals / sheet
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing(4),
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(Platform.OS === 'ios' ? 10 : 6),
    maxHeight: '88%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
    alignSelf: 'center',
    marginBottom: theme.spacing(3),
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(3),
  },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(2), marginTop: theme.spacing(2) },
  selectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    maxWidth: '100%',
  },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing(5),
  },
  toggleTrack: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 2,
    justifyContent: 'center',
  },
  toggleTrackOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  toggleThumbOn: { alignSelf: 'flex-end' },
  notesInput: {
    marginTop: theme.spacing(2),
    minHeight: 64,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    fontSize: theme.font.body,
    padding: theme.spacing(3),
    textAlignVertical: 'top',
  },
  textField: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    fontSize: theme.font.body,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
  },
  twoCol: { flexDirection: 'row', gap: theme.spacing(3) },
  col: { flex: 1 },
});
