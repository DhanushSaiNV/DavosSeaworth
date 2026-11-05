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
import { Icon } from '../../components/ui/Icon';
import { logger } from '../../lib/logger';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { useTheme } from '../../theme';
import { BottomNav, NavItem } from '../../components/davos/BottomNav';
import { SideRail } from '../../components/davos/SideRail';
import { TodayPanel } from '../../components/davos/TodayPanel';
import { PlanEditorModal } from '../../components/davos/PlanEditorModal';
import {
  initialStatusLine,
  sampleTodayDoings,
  sampleTodayPlanItems,
} from '../../fixtures/davos';
import { DayProvider, useDayContext } from '../../domain/DayContext';
import { FixtureBadge } from '../../components/FixtureBadge';

/**
 * FP-09 FR-10 — the route gate. Every post-auth and deep-link entry converges on this
 * shell, so the stage read lives here: a non-complete user is replaced into the interview
 * before `AppTabs` (and therefore the check-in scheduler, push registration and impulse
 * notification) can mount.
 */
export default function AppLayout() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;
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
      <View style={[styles.gate, { backgroundColor: canvasBg }]}>
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
      <View style={[styles.gate, { backgroundColor: canvasBg }]}>
        <LoadingMark size="large" />
      </View>
    );
  }

  return (
    <DayProvider>
      <AppTabs />
    </DayProvider>
  );
}

/** The responsive Shell for Davos (PRD §0, §6, §8, §12). */
function AppTabs() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const registeredFor = useRef<string | null>(null);
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;

  const { width } = useWindowDimensions();
  const isCompact = width < 768;
  const isRegular = width >= 768 && width < 1200;

  const {
    snapshot,
    setFocusedBeatId,
    planAnchors,
    setPlanAnchors,
    activityEvents,
    tracker,
  } = useDayContext();
  const [railCollapsed, setRailCollapsed] = useState<boolean>(false);
  const [todayPanelCollapsed, setTodayPanelCollapsed] = useState<boolean>(false);
  const [planEditorVisible, setPlanEditorVisible] = useState<boolean>(false);

  // Active tab determination (Settings is not a rail destination per PRD A.4)
  const isSettings = pathname.includes('settings');
  const activeKey = isSettings
    ? null
    : pathname.includes('today')
    ? 'today'
    : pathname.includes('proof')
    ? 'proof'
    : 'chat';

  // Cap of 3 destinations (PRD §6: Davos, Today, Proof)
  const navItems: NavItem[] = [
    { key: 'chat', label: 'Davos' },
    { key: 'today', label: 'Today' },
    { key: 'proof', label: 'Proof' },
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

  // Shell header with screen title and Settings overflow action (PRD §0, §6, §8, A.4, G, F.3, F.4, C.4)
  const renderHeader = () => {
    if (isSettings) {
      return (
        <View style={[styles.shellHeader, { borderBottomColor: colors.divider, backgroundColor: canvasBg }]}>
          <View style={styles.headerRowInner}>
            <View style={styles.headerLeftGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to Davos"
                hitSlop={touchTarget.hitSlop}
                style={styles.backButton}
                onPress={() => router.navigate('/(app)/chat')}>
                <Icon name="arrow-left" size={20} color={colors.textPrimary} />
              </Pressable>
              <Text
                style={[styles.shellHeaderTitle, typeRoles.title, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                Settings
              </Text>
            </View>
          </View>
        </View>
      );
    }

    const showHeaderMeta = activeKey === 'chat';
    const headerMetaText = '4 of 5 · next 20:30';

    return (
      <View style={[styles.shellHeader, { borderBottomColor: colors.divider, backgroundColor: canvasBg }]}>
        <View style={styles.headerRowInner}>
          <View style={styles.headerTitleColumn}>
            <View style={styles.headerTitleRow}>
              <Text
                style={[styles.shellHeaderTitle, typeRoles.title, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                {activeKey === 'today' ? 'Today' : activeKey === 'proof' ? 'Proof' : 'Davos'}
              </Text>
              {activeKey === 'chat' && <FixtureBadge />}
            </View>
            {showHeaderMeta && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Today schedule"
                hitSlop={touchTarget.hitSlop}
                onPress={() => router.navigate('/(app)/today')}>
                <Text
                  style={[styles.headerMetaText, typeRoles.meta, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  {headerMetaText}
                </Text>
              </Pressable>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options"
            hitSlop={touchTarget.hitSlop}
            style={styles.overflowButton}
            onPress={() => router.push('/(app)/settings')}>
            <Icon name="more-horizontal" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>
    );
  };

  const tabsContent = (
    <View style={styles.tabsWrapper}>
      {renderHeader()}
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: canvasBg },
          tabBarStyle: { display: 'none' }, // Fully handled by custom canonical Shell components
        }}>
        <Tabs.Screen name="chat" options={{ title: 'Davos' }} />
        <Tabs.Screen name="today" options={{ title: 'Today' }} />
        <Tabs.Screen name="proof" options={{ title: 'Proof' }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
    </View>
  );

  // Compact layout (< 768dp): Bottom bar with 3 items
  if (isCompact) {
    return (
      <View style={[styles.shellContainer, { backgroundColor: canvasBg }]}>
        <View style={styles.centerFlex}>{tabsContent}</View>
        <BottomNav
          items={navItems}
          selectedKey={activeKey ?? ''}
          onSelect={handleSelectNav}
        />
      </View>
    );
  }

  // Regular layout (768 - 1199dp): Collapsible left rail
  if (isRegular) {
    return (
      <View style={[styles.horizontalShellContainer, { backgroundColor: canvasBg }]}>
        <SideRail
          items={navItems}
          selectedKey={activeKey ?? ''}
          onSelect={handleSelectNav}
          isCollapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((prev) => !prev)}
        />
        <View style={styles.centerFlex}>
          <View style={styles.wideMaxContainer}>{tabsContent}</View>
        </View>
      </View>
    );
  }

  // Wide layout (>= 1200dp): Left rail + centred content + docked TodayPanel (Davos thread only)
  return (
    <View style={[styles.horizontalShellContainer, { backgroundColor: canvasBg }]}>
      <SideRail
        items={navItems}
        selectedKey={activeKey ?? ''}
        onSelect={handleSelectNav}
        isCollapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((prev) => !prev)}
      />

      <View style={styles.wideCenterColumn}>
        <View style={styles.wideMaxContainer}>{tabsContent}</View>
      </View>

      {activeKey === 'chat' && !isSettings && (
        <TodayPanel
          snapshot={snapshot}
          planAnchors={planAnchors}
          activityEvents={activityEvents}
          trackerState={tracker}
          onSelectBeat={(id) => setFocusedBeatId(id)}
          isCollapsed={todayPanelCollapsed}
          onToggleCollapse={() => setTodayPanelCollapsed((prev) => !prev)}
          onOpenPlanEditor={() => setPlanEditorVisible(true)}
        />
      )}

      <PlanEditorModal
        visible={planEditorVisible}
        initialAnchors={planAnchors}
        onClose={() => setPlanEditorVisible(false)}
        onSave={(updated) => setPlanAnchors(updated)}
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
  },
  wideMaxContainer: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    flex: 1,
  },
  tabsWrapper: {
    flex: 1,
  },
  shellHeader: {
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  headerRowInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitleColumn: {
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerMetaText: {
    paddingHorizontal: spacing.none,
  },
  shellHeaderTitle: {
    paddingHorizontal: spacing.none,
  },
  backButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    paddingHorizontal: spacing.none,
  },
  headerSpacer: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
  },
  overflowButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overflowButtonText: {
    paddingHorizontal: spacing.none,
  },
});
