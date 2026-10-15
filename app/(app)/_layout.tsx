import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { loadConfig } from '../../lib/config';
import { loadDevOverrides } from '../../lib/devOverrides';

export default function AppLayout() {
  // `config` holds every [SPEC] value (AGENTS.md §2). Load it once for the whole
  // signed-in app; screens fail closed until it is available.
  useEffect(() => {
    void loadConfig();
    // Dev-only tier/domain forcer (Step 6); a no-op in a production build.
    void loadDevOverrides();
  }, []);

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
