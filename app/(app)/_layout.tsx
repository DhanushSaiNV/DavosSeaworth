import { useEffect, useRef } from 'react';
import { AppState, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { loadConfig } from '../../lib/config';
import { loadDevOverrides } from '../../lib/devOverrides';
import { useAuth } from '../../lib/auth';
import { registerPushToken } from '../../lib/push';
import { armCheckins, cancelCheckins, installNetInfoListener } from '../../lib/checkins';
import { armImpulseNotification, disarmImpulseNotification } from '../../lib/impulse';
import { useTheme } from '../../theme';
import { Icon } from '../../components/ui';
import { logger } from '../../lib/logger';

export default function AppLayout() {
  const { user } = useAuth();
  const registeredFor = useRef<string | null>(null);
  const { colors, typography, elevation } = useTheme();
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && width >= 900;

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
      logger.warn('push', 'registration failed', undefined, err),
    );
  }, [user?.id]);

  // FP-04 Step 4: arm the check-in scheduler on auth + AppState active (TECH-SPEC §8).
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

  // FP-08 Step 8: the Android persistent impulse notification (FR-20). No-op on iOS/web,
  // where the composer button is the logging surface.
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    void armImpulseNotification(userId);
    return () => {
      void disarmImpulseNotification();
    };
  }, [user?.id]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSubtle,
          borderTopWidth: StyleSheet.hairlineWidth,
          ...(isWideWeb
            ? {
                ...elevation.raised,
                alignSelf: 'center',
                width: Math.min(width - 64, 640),
                height: 62,
                marginBottom: 16,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: colors.borderSubtle,
                paddingBottom: 0,
              }
            : {
                elevation: 0,
                ...(Platform.OS === 'web' ? { height: 54 } : null),
              }),
        },
        tabBarLabelStyle: {
          fontSize: typography.caption.fontSize,
          lineHeight: 14,
          fontWeight: typography.caption.fontWeight,
        },
      }}>
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color, size }) => (
            <Icon name="message-square" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: 'Journal',
          tabBarIcon: ({ color, size }) => (
            <Icon name="book-open" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Overview',
          tabBarIcon: ({ color, size }) => (
            <Icon name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Icon name="sliders" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
