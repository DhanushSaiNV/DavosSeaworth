import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Tabs } from 'expo-router';
import { loadConfig } from '../../lib/config';
import { loadDevOverrides } from '../../lib/devOverrides';
import { useAuth } from '../../lib/auth';
import { registerPushToken } from '../../lib/push';
import { armCheckins, cancelCheckins, installNetInfoListener } from '../../lib/checkins';

export default function AppLayout() {
  const { user } = useAuth();
  const registeredFor = useRef<string | null>(null);

  // `config` holds every [SPEC] value (AGENTS.md §2). Load it once for the whole
  // signed-in app; screens fail closed until it is available.
  useEffect(() => {
    void loadConfig();
    // Dev-only tier/domain forcer (Step 6); a no-op in a production build.
    void loadDevOverrides();
  }, []);

  // Register for push notifications once per authenticated session (Step 7).
  // Dependency is user?.id (a primitive), not the User object — Supabase issues a new
  // User object on every TOKEN_REFRESHED event, which would retrigger registration on
  // every JWT refresh cycle if we depend on the object reference.
  useEffect(() => {
    if (!user || registeredFor.current === user.id) return;
    registeredFor.current = user.id;
    registerPushToken(user.id).catch((err) =>
      console.warn('[push] registration failed:', err instanceof Error ? err.message : err),
    );
  }, [user?.id]);

  // FP-04 Step 4: arm the check-in scheduler on auth + AppState active (TECH-SPEC §8).
  // Dependency is user?.id (a primitive) NOT [user] (an object). Supabase emits a new User
  // object on every TOKEN_REFRESHED (~55 min cycle) via onAuthStateChange. A [user] dep
  // would cause cleanup → cancelAllScheduledNotificationsAsync() to race the re-arm on
  // every token refresh, randomly leaving zero alarms pending (confirmed by dumpsys alarm).
  // [user?.id] is stable for the entire signed-in session; only changes on sign-in/sign-out.
  // The AppState listener captures userId by value so its closure is never stale.
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    void armCheckins(userId);
    installNetInfoListener();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void armCheckins(userId);
    });
    return () => {
      sub.remove();
      void cancelCheckins();
    };
  }, [user?.id]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#000',
        tabBarInactiveTintColor: '#888',
      }}>
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal' }} />
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
