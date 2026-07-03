/**
 * Shared UI primitives. Screens compose from these instead of raw RN views so
 * spacing, color, and typography stay consistent. Import from '@/components/ui'.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/theme';

type FontVariant = keyof typeof theme.font;
type WeightVariant = keyof typeof theme.weight;

export function ThemedText({
  children,
  variant = 'body',
  weight = 'regular',
  color = theme.colors.text,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  variant?: FontVariant;
  weight?: WeightVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { fontSize: theme.font[variant], fontWeight: theme.weight[weight], color },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  refreshing,
  onRefresh,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const inner = (
    <View style={[padded && { paddingHorizontal: theme.spacing(4) }, { paddingBottom: theme.spacing(8) }]}>
      {children}
    </View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingTop: theme.spacing(2) }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.textMuted}
              />
            ) : undefined
          }
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const content = <View style={[styles.card, style]}>{children}</View>;
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        {content}
      </Pressable>
    );
  }
  return content;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    variant === 'primary' ? theme.colors.primary : variant === 'danger' ? theme.colors.danger : 'transparent';
  const fg = variant === 'ghost' ? theme.colors.text : '#fff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonRow}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <ThemedText weight="semibold" color={fg}>
            {title}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

/** Currency formatting shared across the app. */
export function formatMoney(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

/**
 * Renders a monetary amount. By Plaid convention amount > 0 is spend, < 0 is
 * income; income is tinted green with a leading "+".
 */
export function Money({
  amount,
  currency = 'USD',
  variant = 'body',
  weight = 'semibold',
  colorBySign = true,
}: {
  amount: number;
  currency?: string;
  variant?: FontVariant;
  weight?: WeightVariant;
  colorBySign?: boolean;
}) {
  const isIncome = amount < 0;
  const color = !colorBySign ? theme.colors.text : isIncome ? theme.colors.income : theme.colors.text;
  return (
    <ThemedText variant={variant} weight={weight} color={color}>
      {isIncome ? '+' : ''}
      {formatMoney(amount, currency)}
    </ThemedText>
  );
}

export function Badge({ label, color = theme.colors.primary }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
      <ThemedText variant="caption" weight="semibold" color={color}>
        {label}
      </ThemedText>
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <ThemedText variant="heading" weight="bold">
        {title}
      </ThemedText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <ThemedText variant="label" weight="semibold" color={theme.colors.primary}>
            {actionLabel}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ProgressBar({
  pct,
  color = theme.colors.primary,
  height = 8,
}: {
  pct: number; // 0..1+ (clamped display, over-budget shown red)
  color?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, pct));
  const over = pct > 1;
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height }]}>
      <View
        style={{
          width: `${clamped * 100}%`,
          height,
          borderRadius: height,
          backgroundColor: over ? theme.colors.danger : color,
        }}
      />
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={theme.colors.textFaint} />
      <ThemedText variant="heading" weight="semibold" style={{ marginTop: theme.spacing(3) }}>
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText color={theme.colors.textMuted} style={{ textAlign: 'center', marginTop: theme.spacing(1) }}>
          {subtitle}
        </ThemedText>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={{ marginTop: theme.spacing(4) }} />
      ) : null}
    </View>
  );
}

export function LoadingState() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing(4),
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  button: {
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing(3.5),
    paddingHorizontal: theme.spacing(4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2) },
  badge: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(0.5),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing(6),
    marginBottom: theme.spacing(3),
  },
  progressTrack: { backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden', width: '100%' },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing(3) },
  empty: { alignItems: 'center', paddingVertical: theme.spacing(12), paddingHorizontal: theme.spacing(6) },
  loading: { paddingVertical: theme.spacing(16), alignItems: 'center' },
});
