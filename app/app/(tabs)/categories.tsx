/**
 * Categories management screen.
 *
 * Lists active categories (with an option to reveal archived ones). Each row
 * shows the color swatch, Ionicons glyph, name, and an ai/user "createdBy"
 * badge. From a row the user can rename / recolor / change icon (edit modal),
 * archive, or merge into another category. A "New category" button opens the
 * same editor in create mode. Tapping a category drills into a feed of that
 * category's transactions (with a running total).
 *
 * All hooks are called unconditionally at the top of the component to respect
 * the Rules of Hooks; the drill-down transaction feed is keyed by the selected
 * category id and simply returns nothing until a category is selected.
 */
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CATEGORY_PALETTE, type Category, type Transaction } from '@expense/shared';
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useArchiveCategory,
  useMergeCategories,
  useTransactionsFeed,
} from '@/hooks';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  LoadingState,
  Money,
  Screen,
  SectionHeader,
  ThemedText,
} from '@/components/ui';
import { theme, fallbackCategoryColor } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** A curated palette of Ionicons glyphs offered in the category editor. */
const ICON_CHOICES: IconName[] = [
  'cart',
  'restaurant',
  'car',
  'home',
  'flash',
  'medkit',
  'airplane',
  'film',
  'barbell',
  'gift',
  'school',
  'paw',
  'wifi',
  'card',
  'trending-up',
  'swap-horizontal',
  'alert-circle',
  'ellipsis-horizontal',
];

/** Safe color for a category — falls back to a deterministic palette color. */
function catColor(c: Category): string {
  return c.color || fallbackCategoryColor(c.categoryId);
}

/** Ionicons is permissive at runtime; narrow an arbitrary glyph string safely. */
function asIcon(name: string): IconName {
  return (name || 'pricetag') as IconName;
}

export default function CategoriesScreen() {
  const router = useRouter();
  const categoriesQuery = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const archiveCategory = useArchiveCategory();
  const mergeCategories = useMergeCategories();

  const [showArchived, setShowArchived] = useState(false);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [mergeSource, setMergeSource] = useState<Category | null>(null);
  const [selected, setSelected] = useState<Category | null>(null);

  const all = categoriesQuery.data ?? [];
  const active = useMemo(() => all.filter((c) => !c.isArchived), [all]);
  const archived = useMemo(() => all.filter((c) => c.isArchived), [all]);
  const visible = showArchived ? all : active;

  // Drill-down feed. Gated on `selected` so it does NOT run (and paginate the
  // whole history) until the user opens a category — an empty categoryId string
  // is falsy, so the hook would otherwise skip the equality filter entirely.
  const feed = useTransactionsFeed(
    { categoryId: selected?.categoryId ?? '' },
    { enabled: !!selected },
  );

  if (categoriesQuery.isLoading) {
    return (
      <Screen>
        <Header onBack={() => router.back()} title="Categories" />
        <LoadingState />
      </Screen>
    );
  }

  // --- Drill-down view -------------------------------------------------
  if (selected) {
    return (
      <CategoryDetail
        category={selected}
        feed={feed}
        onBack={() => setSelected(null)}
      />
    );
  }

  // --- List view -------------------------------------------------------
  return (
    <Screen
      refreshing={categoriesQuery.isRefetching}
      onRefresh={() => categoriesQuery.refetch()}
    >
      <Header onBack={() => router.back()} title="Categories" />

      <Button
        title="New category"
        icon="add"
        onPress={() => setEditorState({ mode: 'create' })}
        style={{ marginTop: theme.spacing(2) }}
      />

      <SectionHeader
        title={`${active.length} active`}
        actionLabel={
          archived.length > 0
            ? showArchived
              ? 'Hide archived'
              : `Show archived (${archived.length})`
            : undefined
        }
        onAction={archived.length > 0 ? () => setShowArchived((v) => !v) : undefined}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title="No categories yet"
          subtitle="Create your first category to start organizing spending."
          actionLabel="New category"
          onAction={() => setEditorState({ mode: 'create' })}
        />
      ) : (
        <Card style={{ padding: 0 }}>
          {visible.map((c, i) => (
            <View key={c.categoryId}>
              {i > 0 ? <Divider /> : null}
              <CategoryRow
                category={c}
                onOpen={() => setSelected(c)}
                onEdit={() => setEditorState({ mode: 'edit', category: c })}
                onArchive={() => archiveCategory(c.categoryId)}
                onMerge={() => setMergeSource(c)}
              />
            </View>
          ))}
        </Card>
      )}

      {editorState ? (
        <CategoryEditor
          state={editorState}
          saving={createCategory.isPending || updateCategory.isPending}
          onCancel={() => setEditorState(null)}
          onSubmit={async (values) => {
            if (editorState.mode === 'create') {
              await createCategory.mutateAsync(values);
            } else {
              await updateCategory.mutateAsync({
                categoryId: editorState.category.categoryId,
                patch: values,
              });
            }
            setEditorState(null);
          }}
        />
      ) : null}

      {mergeSource ? (
        <MergePicker
          source={mergeSource}
          candidates={active.filter((c) => c.categoryId !== mergeSource.categoryId)}
          merging={mergeCategories.isPending}
          onCancel={() => setMergeSource(null)}
          onConfirm={async (target) => {
            await mergeCategories.mutateAsync({
              sourceId: mergeSource.categoryId,
              targetId: target.categoryId,
              targetName: target.name,
            });
            setMergeSource(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

// ======================================================================
//  Co-located helper components
// ======================================================================

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        <ThemedText weight="semibold">Back</ThemedText>
      </Pressable>
      <ThemedText variant="title" weight="bold" style={{ marginTop: theme.spacing(2) }}>
        {title}
      </ThemedText>
    </View>
  );
}

function CategoryRow({
  category,
  onOpen,
  onEdit,
  onArchive,
  onMerge,
}: {
  category: Category;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onMerge: () => void;
}) {
  const color = catColor(category);
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.swatch, { backgroundColor: color + '22', borderColor: color }]}>
        <Ionicons name={asIcon(category.icon)} size={18} color={color} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.rowTitle}>
          <ThemedText weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {category.name}
          </ThemedText>
          <Badge
            label={category.createdBy === 'ai' ? 'AI' : 'You'}
            color={category.createdBy === 'ai' ? theme.colors.primary : theme.colors.textMuted}
          />
          {category.isArchived ? <Badge label="Archived" color={theme.colors.warn} /> : null}
        </View>
        {category.description ? (
          <ThemedText variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {category.description}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.rowActions}>
        <IconButton icon="create-outline" onPress={onEdit} />
        {!category.isArchived ? (
          <>
            <IconButton icon="git-merge-outline" onPress={onMerge} />
            <IconButton icon="archive-outline" onPress={onArchive} />
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

function IconButton({ icon, onPress }: { icon: IconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.iconBtn}>
      <Ionicons name={icon} size={20} color={theme.colors.textMuted} />
    </Pressable>
  );
}

// --- Category editor (create + edit) ----------------------------------

type EditorState = { mode: 'create' } | { mode: 'edit'; category: Category };

interface EditorValues {
  name: string;
  color: string;
  icon: string;
  description: string | null;
}

function CategoryEditor({
  state,
  saving,
  onCancel,
  onSubmit,
}: {
  state: EditorState;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: EditorValues) => void;
}) {
  const existing = state.mode === 'edit' ? state.category : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [color, setColor] = useState(existing?.color || CATEGORY_PALETTE[0]!);
  const [icon, setIcon] = useState<IconName>(asIcon(existing?.icon ?? ICON_CHOICES[0]!));

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !saving;

  return (
    <ModalSheet
      title={state.mode === 'create' ? 'New category' : 'Edit category'}
      onClose={onCancel}
    >
      <FieldLabel>Preview</FieldLabel>
      <View style={styles.previewRow}>
        <View style={[styles.swatch, { backgroundColor: color + '22', borderColor: color }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        <ThemedText weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
          {trimmed || 'Untitled'}
        </ThemedText>
      </View>

      <FieldLabel>Name</FieldLabel>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Groceries"
        placeholderTextColor={theme.colors.textFaint}
        style={styles.input}
        autoFocus
      />

      <FieldLabel>Description (optional)</FieldLabel>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="What belongs here?"
        placeholderTextColor={theme.colors.textFaint}
        style={styles.input}
      />

      <FieldLabel>Color</FieldLabel>
      <View style={styles.paletteRow}>
        {CATEGORY_PALETTE.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            style={[
              styles.paletteDot,
              { backgroundColor: c },
              color === c && styles.paletteDotSelected,
            ]}
          >
            {color === c ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
          </Pressable>
        ))}
      </View>

      <FieldLabel>Icon</FieldLabel>
      <View style={styles.iconGrid}>
        {ICON_CHOICES.map((g) => {
          const active = g === icon;
          return (
            <Pressable
              key={g}
              onPress={() => setIcon(g)}
              style={[
                styles.iconCell,
                active && { borderColor: color, backgroundColor: color + '22' },
              ]}
            >
              <Ionicons name={g} size={20} color={active ? color : theme.colors.textMuted} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.modalActions}>
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title={state.mode === 'create' ? 'Create' : 'Save'}
          loading={saving}
          disabled={!canSave}
          onPress={() =>
            onSubmit({
              name: trimmed,
              color,
              icon,
              description: description.trim() ? description.trim() : null,
            })
          }
          style={{ flex: 1 }}
        />
      </View>
    </ModalSheet>
  );
}

// --- Merge picker -----------------------------------------------------

function MergePicker({
  source,
  candidates,
  merging,
  onCancel,
  onConfirm,
}: {
  source: Category;
  candidates: Category[];
  merging: boolean;
  onCancel: () => void;
  onConfirm: (target: Category) => void;
}) {
  const [target, setTarget] = useState<Category | null>(null);

  return (
    <ModalSheet title={`Merge "${source.name}"`} onClose={onCancel}>
      <ThemedText color={theme.colors.textMuted} style={{ marginBottom: theme.spacing(3) }}>
        Move every transaction in "{source.name}" into another category, then
        archive "{source.name}". This can't be undone automatically.
      </ThemedText>

      {candidates.length === 0 ? (
        <ThemedText color={theme.colors.textMuted}>
          No other active categories to merge into.
        </ThemedText>
      ) : (
        <View style={styles.mergeList}>
          {candidates.map((c) => {
            const color = catColor(c);
            const isTarget = target?.categoryId === c.categoryId;
            return (
              <Pressable
                key={c.categoryId}
                onPress={() => setTarget(c)}
                style={[
                  styles.mergeRow,
                  isTarget && { borderColor: color, backgroundColor: color + '15' },
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: color + '22', borderColor: color }]}>
                  <Ionicons name={asIcon(c.icon)} size={16} color={color} />
                </View>
                <ThemedText weight="medium" style={{ flex: 1 }} numberOfLines={1}>
                  {c.name}
                </ThemedText>
                {isTarget ? (
                  <Ionicons name="checkmark-circle" size={20} color={color} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.modalActions}>
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title="Merge & archive"
          variant="danger"
          loading={merging}
          disabled={!target || merging}
          onPress={() => target && onConfirm(target)}
          style={{ flex: 1 }}
        />
      </View>
    </ModalSheet>
  );
}

// --- Drill-down: a category's transactions ----------------------------

function CategoryDetail({
  category,
  feed,
  onBack,
}: {
  category: Category;
  feed: ReturnType<typeof useTransactionsFeed>;
  onBack: () => void;
}) {
  const color = catColor(category);
  const txns = useMemo<Transaction[]>(
    () => (feed.data?.pages ?? []).flatMap((p) => p.items),
    [feed.data],
  );
  // Spend total: positive amounts only (Plaid convention).
  const total = useMemo(
    () => txns.reduce((sum, t) => (t.amount > 0 ? sum + t.amount : sum), 0),
    [txns],
  );

  return (
    <Screen
      refreshing={feed.isRefetching}
      onRefresh={() => feed.refetch()}
    >
      <Header onBack={onBack} title={category.name} />

      <Card style={styles.summaryCard}>
        <View style={[styles.swatchLg, { backgroundColor: color + '22', borderColor: color }]}>
          <Ionicons name={asIcon(category.icon)} size={26} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText variant="caption" color={theme.colors.textMuted}>
            Total spend ({txns.length} {txns.length === 1 ? 'transaction' : 'transactions'})
          </ThemedText>
          <Money amount={total} variant="title" colorBySign={false} />
        </View>
      </Card>

      {feed.isLoading ? (
        <LoadingState />
      ) : txns.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No transactions"
          subtitle={`Nothing has been categorized as "${category.name}" yet.`}
        />
      ) : (
        <>
          <SectionHeader title="Transactions" />
          <Card style={{ padding: 0 }}>
            {txns.map((t, i) => (
              <View key={t.plaidTxnId || `${t.name}-${i}`}>
                {i > 0 ? <Divider /> : null}
                <TransactionRow txn={t} />
              </View>
            ))}
          </Card>
          {feed.hasNextPage ? (
            <Button
              title={feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
              variant="ghost"
              loading={feed.isFetchingNextPage}
              onPress={() => feed.fetchNextPage()}
              style={{ marginTop: theme.spacing(4) }}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function TransactionRow({ txn }: { txn: Transaction }) {
  const date = txn.date.toDate();
  const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <View style={styles.txnRow}>
      <View style={{ flex: 1, marginRight: theme.spacing(3) }}>
        <ThemedText weight="medium" numberOfLines={1}>
          {txn.merchantName || txn.name}
        </ThemedText>
        <View style={styles.txnMeta}>
          <ThemedText variant="caption" color={theme.colors.textMuted}>
            {dateLabel}
          </ThemedText>
          {txn.pending ? <Badge label="Pending" color={theme.colors.warn} /> : null}
        </View>
      </View>
      <Money amount={txn.amount} currency={txn.isoCurrencyCode ?? 'USD'} />
    </View>
  );
}

// --- Generic bottom-sheet-style modal ---------------------------------

function ModalSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <ThemedText variant="heading" weight="bold" style={{ flex: 1 }} numberOfLines={1}>
            {title}
          </ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={theme.colors.textMuted} />
          </Pressable>
        </View>
        {children}
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

const styles = StyleSheet.create({
  header: { marginBottom: theme.spacing(2) },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1) },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(4),
  },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2) },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1) },
  iconBtn: { padding: theme.spacing(1.5) },

  swatch: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLg: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(4),
    marginTop: theme.spacing(2),
  },

  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(4),
  },
  txnMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    marginTop: theme.spacing(1),
  },

  // Modal
  backdrop: { flex: 1, backgroundColor: theme.colors.overlay },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    padding: theme.spacing(5),
    paddingBottom: theme.spacing(10),
    borderTopWidth: 1,
    borderColor: theme.colors.border,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.border,
    marginBottom: theme.spacing(4),
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2) },

  input: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3.5),
    paddingVertical: theme.spacing(3),
    color: theme.colors.text,
    fontSize: theme.font.body,
  },

  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(3),
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: theme.spacing(3),
  },

  paletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(2.5) },
  paletteDot: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paletteDotSelected: { borderWidth: 2, borderColor: theme.colors.text },

  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(2) },
  iconCell: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  mergeList: { gap: theme.spacing(2) },
  mergeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(3),
    padding: theme.spacing(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },

  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing(3),
    marginTop: theme.spacing(6),
  },
});
