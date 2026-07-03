import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Dynamic Expo config. Reads client-safe values from EXPO_PUBLIC_* env (loaded
 * from app/.env by Expo). A custom dev-client build is required — Plaid Link,
 * Google Sign-In, and push notifications cannot run in Expo Go.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Expense Manager',
  slug: 'expense-manager',
  scheme: 'expensemanager',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.opang.expensemanager',
    // Firebase iOS config — place the file at app/GoogleService-Info.plist.
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.opang.expensemanager',
    // Firebase Android config — place at app/google-services.json.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
  extra: {
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    },
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    [
      'expo-notifications',
      {
        color: '#4F46E5',
      },
    ],
    [
      '@react-native-google-signin/google-signin',
      {
        // The reversed iOS client id from GoogleService-Info.plist. When the
        // googleServicesFile is present the plugin can infer this; set it
        // explicitly if prebuild complains.
        iosUrlScheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME,
      },
    ],
    [
      'expo-build-properties',
      {
        ios: { deploymentTarget: '15.1', useFrameworks: 'static' },
        android: { minSdkVersion: 24 },
      },
    ],
  ],
  experiments: {
    // Disabled for now: typed routes type-check group-path strings like
    // '/(tabs)/dashboard', which is friction during initial scaffolding.
    // Re-enable once routes stabilize (`npx expo customize` / expo-router docs).
    typedRoutes: false,
  },
});
