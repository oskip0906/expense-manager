/**
 * Settings screen.
 *
 * Sections:
 *  1. Linked banks   — institutions + their accounts (name / mask / balance),
 *                      link a new bank, and per-item unlink (with confirm).
 *  2. Notifications  — push toggle bound to profile.settings.notifChannels.push.
 *  3. Account        — signed-in identity + sign out.
 *  4. Categories     — deep-link to the categories manager.
 *
 * Also surfaces the last nightly-pipeline sync time from useSyncState().
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { paths, type Account, type PlaidItem, type PlaidItemStatus } from '@expense/shared';
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
import {
  useAccounts,
  usePlaidItems,
  useProfile,
  useSyncState,
} from '@/hooks';
import { useAuth, useUid } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { linkBankAccount, unlinkBank } from '@/lib/plaid';
import { qk } from '@/lib/queryKeys';
import { theme } from '@/theme';

// --- Helpers ---------------------------------------------------------------

const STATUS_META: Record<
  PlaidItemStatus,
  { label: string; color: string } | null
> = {
  good: null,
  login_required: { label: 'Reconnect needed', color: theme.colors.danger },
  pending_expiration: { label: 'Expiring soon', color: theme.colors.warn },
  error: { label: 'Sync error', color: theme.colors.danger },
};

/** Human-friendly "time ago" for the last sync stamp. */
function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

// --- Sub-components (kept local to avoid name collisions) ------------------

function LinkedBankCard({
  item,
  accounts,
  onUnlink,
  unlinking,
}: {
  item: PlaidItem;
  accounts: Account[];
  onUnlink: (item: PlaidItem) => void;
  unlinking: boolean;
}) {
  const status = STATUS_META[item.status];
  return (
    <Card style={styles.bankCard}>
      <View style={styles.bankHeader}>
        <View style={styles.bankTitle}>
          <Ionicons name="business" size={18} color={theme.colors.primary} />
          <ThemedText variant="heading" weight="semibold" numberOfLines={1}>
            {item.institutionName}
          </ThemedText>
        </View>
        {status ? <Badge label={status.label} color={status.color} /> : null}
      </View>

      {accounts.length === 0 ? (
        <ThemedText
          variant="label"
          color={theme.colors.textMuted}
          style={{ marginTop: theme.spacing(2) }}
        >
          No accounts synced yet.
        </ThemedText>
      ) : (
        accounts.map((acct, i) => (
          <View key={acct.accountId}>
            {i === 0 ? (
              <View style={{ height: theme.spacing(3) }} />
            ) : (
              <Divider />
            )}
            <View style={styles.acctRow}>
              <View style={styles.acctInfo}>
                <ThemedText weight="medium" numberOfLines={1}>
                  {acct.name}
                </ThemedText>
                <ThemedText variant="caption" color={theme.colors.textFaint}>
                  {acct.mask ? `•••• ${acct.mask}` : acct.type}
                </ThemedText>
              </View>
              {acct.currentBalance != null ? (
                <Money
                  amount={acct.currentBalance}
                  currency={acct.isoCurrencyCode ?? 'USD'}
                  colorBySign={false}
                />
              ) : (
                <ThemedText variant="label" color={theme.colors.textFaint}>
                  —
                </ThemedText>
              )}
            </View>
          </View>
        ))
      )}

      <Button
        title="Unlink bank"
        variant="ghost"
        icon="unlink"
        onPress={() => onUnlink(item)}
        loading={unlinking}
        style={{ marginTop: theme.spacing(4) }}
      />
    </Card>
  );
}

function SettingRow({
  icon,
  label,
  value,
  onPress,
  trailing,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Card onPress={onPress} style={styles.rowCard}>
      <View style={styles.rowLeft}>
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={18} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText weight="medium">{label}</ThemedText>
          {value ? (
            <ThemedText variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
              {value}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {trailing ??
        (onPress ? (
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textFaint} />
        ) : null)}
    </Card>
  );
}

// --- Screen ----------------------------------------------------------------

export default function SettingsScreen() {
  const router = useRouter();
  const uid = useUid();
  const qc = useQueryClient();
  const { user, signOut } = useAuth();

  const profileQ = useProfile();
  const itemsQ = usePlaidItems();
  const accountsQ = useAccounts();
  const syncQ = useSyncState();

  const [linking, setLinking] = useState(false);
  const [unlinkingItemId, setUnlinkingItemId] = useState<string | null>(null);
  const [savingNotif, setSavingNotif] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Group accounts by their owning Plaid item for the banks section.
  const accountsByItem = useMemo(() => {
    const map = new Map<string, Account[]>();
    for (const acct of accountsQ.data ?? []) {
      const list = map.get(acct.itemId) ?? [];
      list.push(acct);
      map.set(acct.itemId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [accountsQ.data]);

  const refetchAll = useCallback(() => {
    profileQ.refetch();
    itemsQ.refetch();
    accountsQ.refetch();
    syncQ.refetch();
  }, [profileQ, itemsQ, accountsQ, syncQ]);

  const invalidateBanks = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.plaidItems(uid) }),
      qc.invalidateQueries({ queryKey: qk.accounts(uid) }),
    ]);
  }, [qc, uid]);

  const handleLink = useCallback(async () => {
    setLinking(true);
    try {
      const result = await linkBankAccount();
      if (result.status === 'linked') {
        await invalidateBanks();
        Alert.alert(
          'Bank linked',
          result.institutionName
            ? `${result.institutionName} connected${
                result.accountsLinked
                  ? ` with ${result.accountsLinked} account${
                      result.accountsLinked === 1 ? '' : 's'
                    }`
                  : ''
              }.`
            : 'Your bank was connected.',
        );
      }
    } catch (e) {
      Alert.alert(
        'Could not link bank',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setLinking(false);
    }
  }, [invalidateBanks]);

  const handleUnlink = useCallback(
    (item: PlaidItem) => {
      Alert.alert(
        'Unlink bank',
        `Remove ${item.institutionName}? Its accounts and future syncs will stop. Existing transactions stay in your history.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unlink',
            style: 'destructive',
            onPress: async () => {
              setUnlinkingItemId(item.itemId);
              try {
                await unlinkBank(item.itemId);
                await invalidateBanks();
              } catch (e) {
                Alert.alert(
                  'Could not unlink',
                  e instanceof Error ? e.message : 'Please try again.',
                );
              } finally {
                setUnlinkingItemId(null);
              }
            },
          },
        ],
      );
    },
    [invalidateBanks],
  );

  const handleTogglePush = useCallback(
    async (value: boolean) => {
      setSavingNotif(true);
      try {
        await updateDoc(doc(db, paths.user(uid)), {
          'settings.notifChannels.push': value,
          updatedAt: serverTimestamp(),
        });
        await qc.invalidateQueries({ queryKey: qk.profile(uid) });
      } catch (e) {
        Alert.alert(
          'Could not update notifications',
          e instanceof Error ? e.message : 'Please try again.',
        );
      } finally {
        setSavingNotif(false);
      }
    },
    [qc, uid],
  );

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign out', 'Sign out of your account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
          } catch (e) {
            setSigningOut(false);
            Alert.alert(
              'Could not sign out',
              e instanceof Error ? e.message : 'Please try again.',
            );
          }
        },
      },
    ]);
  }, [signOut]);

  // Wait on the first load of the primary data sets before rendering.
  const initialLoading =
    (profileQ.isLoading && !profileQ.data) ||
    (itemsQ.isLoading && !itemsQ.data) ||
    (accountsQ.isLoading && !accountsQ.data);

  const refreshing =
    profileQ.isFetching || itemsQ.isFetching || accountsQ.isFetching || syncQ.isFetching;

  const items = itemsQ.data ?? [];
  const pushEnabled = profileQ.data?.settings.notifChannels.push ?? true;

  const lastSyncAt = syncQ.data?.lastRunAt?.toDate() ?? null;
  const syncStatus = syncQ.data?.lastRunStatus ?? null;

  return (
    <Screen refreshing={refreshing} onRefresh={refetchAll}>
      <ThemedText variant="display" weight="bold" style={{ marginTop: theme.spacing(2) }}>
        Settings
      </ThemedText>

      {initialLoading ? (
        <LoadingState />
      ) : (
        <>
          {/* --- Linked banks --- */}
          <SectionHeader title="Linked banks" />

          {items.length === 0 ? (
            <EmptyState
              icon="business-outline"
              title="No banks linked"
              subtitle="Connect a bank to import and categorize your transactions automatically."
              actionLabel="Link a bank"
              onAction={handleLink}
            />
          ) : (
            <>
              {items.map((item) => (
                <LinkedBankCard
                  key={item.itemId}
                  item={item}
                  accounts={accountsByItem.get(item.itemId) ?? []}
                  onUnlink={handleUnlink}
                  unlinking={unlinkingItemId === item.itemId}
                />
              ))}
              <Button
                title="Link a bank"
                icon="add"
                onPress={handleLink}
                loading={linking}
                style={{ marginTop: theme.spacing(2) }}
              />
            </>
          )}

          {/* --- Notifications --- */}
          <SectionHeader title="Notifications" />
          <SettingRow
            icon="notifications-outline"
            label="Push notifications"
            value="Daily spending insights and budget alerts"
            trailing={
              <Switch
                value={pushEnabled}
                onValueChange={handleTogglePush}
                disabled={savingNotif}
                trackColor={{
                  false: theme.colors.surfaceAlt,
                  true: theme.colors.primary,
                }}
                thumbColor={theme.colors.text}
                ios_backgroundColor={theme.colors.surfaceAlt}
              />
            }
          />

          {/* --- Categories --- */}
          <SectionHeader title="Organize" />
          <SettingRow
            icon="pricetags-outline"
            label="Categories"
            value="Rename, recolor, archive, or merge categories"
            onPress={() => router.push('/(tabs)/categories')}
          />

          {/* --- Account --- */}
          <SectionHeader title="Account" />
          <SettingRow
            icon="person-circle-outline"
            label={user?.displayName ?? 'Signed in'}
            value={user?.email ?? undefined}
          />
          <Button
            title="Sign out"
            variant="danger"
            icon="log-out-outline"
            onPress={handleSignOut}
            loading={signingOut}
            style={{ marginTop: theme.spacing(2) }}
          />

          {/* --- Last sync footer --- */}
          <View style={styles.footer}>
            {lastSyncAt ? (
              <ThemedText variant="caption" color={theme.colors.textFaint}>
                {syncStatus === 'error'
                  ? `Last sync failed ${formatRelative(lastSyncAt)}`
                  : `Last synced ${formatRelative(lastSyncAt)}${
                      syncStatus === 'partial' ? ' (partial)' : ''
                    }`}
              </ThemedText>
            ) : (
              <ThemedText variant="caption" color={theme.colors.textFaint}>
                Not synced yet — data updates nightly.
              </ThemedText>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bankCard: { marginBottom: theme.spacing(3) },
  bankHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  },
  bankTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    flexShrink: 1,
  },
  acctRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(3),
  },
  acctInfo: { flex: 1 },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(3),
    marginBottom: theme.spacing(2),
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(3),
    flex: 1,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    marginTop: theme.spacing(8),
    alignItems: 'center',
  },
});
