import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { registerForPush } from '@/lib/push';
import { theme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function tab(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );
}

export default function TabsLayout() {
  const { user } = useAuth();

  // Register this device for push once we have an authenticated user.
  useEffect(() => {
    if (user) registerForPush(user.uid).catch(() => {});
  }, [user]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textFaint,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Home', tabBarIcon: tab('home') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Activity', tabBarIcon: tab('list') }} />
      <Tabs.Screen name="trends" options={{ title: 'Trends', tabBarIcon: tab('bar-chart') }} />
      <Tabs.Screen name="budgets" options={{ title: 'Budgets', tabBarIcon: tab('wallet') }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights', tabBarIcon: tab('sparkles') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tab('settings') }} />
      {/* Reachable via navigation but hidden from the tab bar. */}
      <Tabs.Screen name="categories" options={{ href: null, title: 'Categories' }} />
    </Tabs>
  );
}
