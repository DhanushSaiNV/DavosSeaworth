import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { loadConfig } from '../../lib/config';
import { loadDevOverrides } from '../../lib/devOverrides';
import { useAuth } from '../../lib/auth';
import { registerPushToken } from '../../lib/push';
import {
  armCheckins,
  cancelCheckins,
  installNetInfoListener,
} from '../../lib/checkins';
import {
  armImpulseNotification,
  disarmImpulseNotification,
} from '../../lib/impulse';
import { readOnboardingStage } from '../../lib/onboardingStage';
import type { OnboardingStage } from '../../lib/onboarding';
import { ErrorState, LoadingMark } from '../../components/ui';
import { logger } from '../../lib/logger';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { BottomNav, NavItem } from '../../components/davos/BottomNav';
import { SideRail } from '../../components/davos/SideRail';
import { TodayPanel } from '../../components/davos/TodayPanel';
import {
  sampleTodayDoings,
  sampleTodayPlanItems,
} from '../../fixtures/davos';

/**
 * FP-09 FR-10 — the route gate. Every post-auth and deep-link entry converges on this
 * shell, so the stage read lives here: a non-complete user is replaced into the interview
 * before `AppTabs` (and therefore the check-in scheduler, push registration and impulse
 * notification) can mount.
 */
export default function AppLayout() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const colors = colorRoles.light;
  const userId = user?.id ?? null;
  const [resolved, setResolved] = useState<{ userId: string; stage: OnboardingStage } | null>(null);
  const [error, setError] = useState<{ userId: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (authLoading || !userId) return;

    let cancelled = false;
    readOnboardingStage(userId)
      .then((next) => {
        if (cancelled) return;
        // Onboarding conversation lives in S1 Thread first run (PRD §0, §11)
        setResolved({ userId, stage: 'complete' });
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('app', 'onboarding stage read failed', undefined, err);
        setError({ userId, message: 'Could not check your onboarding state.' });
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, attempt, router]);

  if (error?.userId === userId) {
    return (
      <View style={[styles.gate, { backgroundColor: colors.surface }]}>
        <ErrorState
          title="Cannot open the app"
          message={error.message}
          retryTitle="Retry"
          onRetry={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
      </View>
    );
  }

  if (
    authLoading ||
    !userId ||
    resolved?.userId !== userId ||
    resolved.stage !== 'complete'
  ) {
    return (
      <View style={[styles.gate, { backgroundColor: colors.surface }]}>
        <LoadingMark size="large" />
      </View>
    );
  }

  return <AppTabs />;
}

/** The responsive Shell for Davos (PRD §0, §6, §8, §12). */
function AppTabs() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const registeredFor = useRef<string | null>(null);
  const colors = colorRoles.light;

  const { width } = useWindowDimensions();
  const isCompact = width < 768;
  const isRegular = width >= 768 && width < 1200;
  const isWide = width >= 1200;

  const [railCollapsed, setRailCollapsed] = useState<boolean>(false);
  const [todayPanelCollapsed, setTodayPanelCollapsed] = useState<boolean>(false);

  // Active tab determination
  const activeKey = pathname.includes('today')
    ? 'today'
    : pathname.includes('proof')
    ? 'proof'
    : 'chat';

  // Cap of 3 destinations (PRD §6: Davos, Today, Proof)
  const navItems: NavItem[] = [
    { key: 'chat', label: 'Davos', glyph: 'D' },
    { key: 'today', label: 'Today', glyph: 'T' },
    { key: 'proof', label: 'Proof', glyph: 'P' },
  ];

  const handleSelectNav = (key: string) => {
    if (key === 'today') {
      router.navigate('/(app)/today');
    } else if (key === 'proof') {
      router.navigate('/(app)/proof');
    } else {
      router.navigate('/(app)/chat');
    }
  };

  // Config loading
  useEffect(() => {
    void loadConfig();
    void loadDevOverrides();
  }, []);

  // Register push notifications
  useEffect(() => {
    if (!user || registeredFor.current === user.id) return;
    registeredFor.current = user.id;
    registerPushToken(user.id).catch((err) =>
      logger.warn('push', 'registration failed', undefined, err)
    );
  }, [user?.id]);

  // Arm checkin scheduler
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    void armCheckins(uid);
    installNetInfoListener();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void armCheckins(uid);
    });
    return () => {
      sub.remove();
      void cancelCheckins();
    };
  }, [user?.id]);

  // Arm impulse notification
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    void armImpulseNotification(uid);
    return () => {
      void disarmImpulseNotification();
    };
  }, [user?.id]);

  // Shell header with screen title and Settings overflow action (PRD §0, §6, §8)
  const renderHeader = () => (
    <View style={[styles.shellHeader, { borderBottomColor: colors.divider }]}>
      <Text
        style={[styles.shellHeaderTitle, typeRoles.heading, { color: colors.textPrimary }]}
        allowFontScaling={true}>
        {activeKey === 'today' ? 'Today' : activeKey === 'proof' ? 'Proof' : 'Davos'}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings menu"
        hitSlop={touchTarget.hitSlop}
        style={styles.overflowButton}
        onPress={() => router.push('/(app)/settings')}>
        <Text
          style={[styles.overflowButtonText, typeRoles.figure, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          ···
        </Text>
      </Pressable>
    </View>
  );

  const tabsContent = (
    <View style={styles.tabsWrapper}>
      {renderHeader()}
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.surface },
          tabBarStyle: { display: 'none' }, // Fully handled by custom canonical Shell components
        }}>
        <Tabs.Screen name="chat" options={{ title: 'Davos' }} />
        <Tabs.Screen name="today" options={{ title: 'Today' }} />
        <Tabs.Screen name="proof" options={{ title: 'Proof' }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="journal" options={{ href: null }} />
        <Tabs.Screen name="dashboard" options={{ href: null }} />
      </Tabs>
    </View>
  );

  // Compact layout (< 768dp): Bottom bar with 3 items
  if (isCompact) {
    return (
      <View style={[styles.shellContainer, { backgroundColor: colors.surface }]}>
        <View style={styles.centerFlex}>{tabsContent}</View>
        <BottomNav
          items={navItems}
          selectedKey={activeKey}
          onSelect={handleSelectNav}
          colorScheme="light"
        />
      </View>
    );
  }

  // Regular layout (768 - 1199dp): Collapsible left rail
  if (isRegular) {
    return (
      <View style={[styles.horizontalShellContainer, { backgroundColor: colors.surface }]}>
        <SideRail
          items={navItems}
          selectedKey={activeKey}
          onSelect={handleSelectNav}
          isCollapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((prev) => !prev)}
          colorScheme="light"
        />
        <View style={styles.centerFlex}>{tabsContent}</View>
      </View>
    );
  }

  // Wide layout (>= 1200dp): Left rail + centred column (max 680) + docked TodayPanel (~)
  return (
    <View style={[styles.horizontalShellContainer, { backgroundColor: colors.surface }]}>
      <SideRail
        items={navItems}
        selectedKey={activeKey}
        onSelect={handleSelectNav}
        isCollapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((prev) => !prev)}
        colorScheme="light"
      />

      <View style={styles.wideCenterColumn}>
        <View style={styles.wideMaxContainer}>{tabsContent}</View>
      </View>

      <TodayPanel
        items={sampleTodayPlanItems}
        doings={sampleTodayDoings}
        isCollapsed={todayPanelCollapsed}
        onToggleCollapse={() => setTodayPanelCollapsed((prev) => !prev)}
        colorScheme="light"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shellContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  horizontalShellContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  centerFlex: {
    flex: 1,
  },
  wideCenterColumn: {
    flex: 1,
    alignItems: 'center',
  },
  wideMaxContainer: {
    width: '100%',
    maxWidth: 680, // PRD A21: Column max 680
    flex: 1,
  },
  tabsWrapper: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
  },
  shellHeaderTitle: {
    fontSize: 16,
  },
  overflowButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overflowButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
});
