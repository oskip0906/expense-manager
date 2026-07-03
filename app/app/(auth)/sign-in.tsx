import { Dimensions, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Screen, ThemedText } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { theme } from '@/theme';

/**
 * Auth landing screen. Centered branding plus a Google sign-in action. The
 * root layout's auth gate handles redirecting into the tabs once `user` is set,
 * so this screen only needs to kick off `signIn()` and surface progress/errors.
 */
export default function SignInScreen() {
  const { signIn, signingIn, error } = useAuth();

  const onSignIn = () => {
    // signIn() rejects on real failures (already reflected via `error`); the
    // catch keeps an unhandled rejection from surfacing as a red-box.
    signIn().catch(() => {});
  };

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.container}>
        <View style={styles.brand}>
          <View style={styles.logoMark}>
            <Ionicons name="wallet" size={40} color={theme.colors.primary} />
          </View>
          <ThemedText variant="display" weight="bold" style={styles.appName}>
            Expense Manager
          </ThemedText>
          <ThemedText
            variant="body"
            color={theme.colors.textMuted}
            style={styles.tagline}
          >
            Track spending, catch surprises, and stay on budget — automatically.
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <Button
            title="Continue with Google"
            icon="logo-google"
            onPress={onSignIn}
            loading={signingIn}
          />
          {error ? (
            <ThemedText
              variant="label"
              color={theme.colors.danger}
              style={styles.error}
            >
              {error}
            </ThemedText>
          ) : null}
          <ThemedText
            variant="caption"
            color={theme.colors.textFaint}
            style={styles.legal}
          >
            We only use your account to sign you in securely.
          </ThemedText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    // `Screen` with scroll={false} wraps children in a content-height view, so
    // fill the viewport ourselves to keep the branding vertically centered.
    minHeight: Dimensions.get('window').height,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(6),
  },
  brand: {
    alignItems: 'center',
    marginBottom: theme.spacing(12),
  },
  logoMark: {
    width: 88,
    height: 88,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing(6),
  },
  appName: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
    marginTop: theme.spacing(3),
    maxWidth: 300,
  },
  actions: {
    gap: theme.spacing(3),
  },
  error: {
    textAlign: 'center',
  },
  legal: {
    textAlign: 'center',
    marginTop: theme.spacing(1),
  },
});
