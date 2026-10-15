import { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { loadConfig } from '../../lib/config';
import { loadDevOverrides } from '../../lib/devOverrides';
import { useAuth } from '../../lib/auth';
import { registerPushToken } from '../../lib/push';

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
  useEffect(() => {
    if (!user || registeredFor.current === user.id) return;
    registeredFor.current = user.id;
    registerPushToken(user.id).catch((err) =>
      console.warn('[push] registration failed:', err instanceof Error ? err.message : err),
    );
  }, [user]);

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
