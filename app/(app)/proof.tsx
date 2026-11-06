// app/(app)/proof.tsx
// Screen S3 (Proof) — Evidence: Oath section, weekly figures, dated ledger, and Life Metrics.
// Refs: design/DESIGN_PRD.md §0, §8, §11, §12, §13, §14; design/ORCA.md §1; design/BREADBOARD.md; TECH-SPEC §7.9.
// Rules: No cards, no elevation, no KPI card rows (PRD §14 #1, #5), no streak art/badges (PRD §14 #4).
// Uses only theme/roles.ts. RN primitives only.

import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import {
  radius,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { BoundOath, oathAdapter } from '../../lib/oathAdapter';
import { useAuth } from '../../lib/auth';
import {
  DoingRecord,
  formatDayLabel,
  sampleTodayDoings,
} from '../../fixtures/davos';
import { OathStatement } from '../../components/davos/OathStatement';
import { DoingLine } from '../../components/davos/DoingLine';
import { useDayContext } from '../../domain/DayContext';
import {
  fetchProofData,
  type ProofMetrics,
  type LedgerDay,
} from '../../lib/proofService';
import {
  fetchUserMetrics,
  type FetchMetricsResult,
} from '../../lib/metricsService';
import { type MetricView } from '../../lib/metricsData';
import { MetricsPanel } from '../../components/davos/MetricsPanel';
import { SegmentedControl } from '../../components/davos/SegmentedControl';
import { hapticSelection } from '../../lib/haptics';

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';
type ProofTab = 'ledger' | 'metrics';

export default function ProofScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab: ProofTab = params.tab === 'metrics' ? 'metrics' : 'ledger';

  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;

  // Active sub-view: 'ledger' (Oath + 7-day overview + check-ins) vs 'metrics' (Life Metrics)
  const [activeTab, setActiveTab] = useState<ProofTab>(initialTab);

  // Sync tab if URL param changes
  useEffect(() => {
    if (params.tab === 'metrics' && activeTab !== 'metrics') {
      setActiveTab('metrics');
    } else if (params.tab === 'ledger' && activeTab !== 'ledger') {
      setActiveTab('ledger');
    }
  }, [params.tab]);

  // Ledger state
  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [boundOath, setBoundOath] = useState<BoundOath | null>(null);
  const [proofMetrics, setProofMetrics] = useState<ProofMetrics>({
    checkinsRatio: '0 of 0',
    onTimePercent: '—',
    urgesHeld: 0,
    weekRangeLabel: '',
    ledgerDays: [],
  });

  // Dynamic Life Metrics state
  const [metricViews, setMetricViews] = useState<MetricView[]>([]);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [metricsRefreshing, setMetricsRefreshing] = useState<boolean>(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [lastMetricsUpdate, setLastMetricsUpdate] = useState<string | undefined>(undefined);

  const { snapshot } = useDayContext();

  // Load bound oath & proof ledger data on mount and tab re-focus (B.4)
  const loadProof = useCallback(() => {
    oathAdapter.getBoundOath().then((oath) => {
      setBoundOath(oath);
    });

    if (userId) {
      setViewState('loading');
      fetchProofData(userId, snapshot.now)
        .then((res) => {
          setProofMetrics(res);
          setViewState(res.ledgerDays.length > 0 ? 'populated' : 'empty');
        })
        .catch(() => {
          setViewState('error');
        });
    } else {
      setViewState('populated');
    }
  }, [userId, snapshot.now]);

  // Load Life Metrics from PostgREST (TECH-SPEC §7.9.5)
  const loadMetricsData = useCallback(
    async (isManualRefresh: boolean = false) => {
      if (!userId) return;
      if (isManualRefresh) {
        setMetricsRefreshing(true);
      } else {
        setMetricsLoading(true);
      }
      setMetricsError(null);

      try {
        const res = await fetchUserMetrics(userId);
        setMetricViews(res.views);
        setLastMetricsUpdate(res.lastUpdated);
      } catch (err) {
        setMetricsError(err instanceof Error ? err.message : String(err));
      } finally {
        setMetricsLoading(false);
        setMetricsRefreshing(false);
      }
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      loadProof();
      void loadMetricsData(false);
    }, [loadProof, loadMetricsData])
  );

  const handleTabChange = (newTab: string) => {
    if (newTab === activeTab) return;
    void hapticSelection();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(newTab as ProofTab);
  };

  // Sample ledger fallback history with dynamic date labels (B2, D4)
  const now = new Date(snapshot.now);
  const formatIsoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayStr = formatIsoDate(now);
  const yesterdayStr = formatIsoDate(new Date(snapshot.now - 24 * 60 * 60 * 1000));
  const twoDaysAgoStr = formatIsoDate(new Date(snapshot.now - 48 * 60 * 60 * 1000));

  // Compute 7-day range label (PRD E.1: "Oct 26 - Nov 1")
  const startRange = new Date(snapshot.now - 6 * 24 * 60 * 60 * 1000);
  const startMonth = startRange.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = now.toLocaleDateString('en-US', { month: 'short' });
  const weekRangeLabel =
    startMonth === endMonth
      ? `${startMonth} ${startRange.getDate()} – ${now.getDate()}`
      : `${startMonth} ${startRange.getDate()} – ${endMonth} ${now.getDate()}`;

  // Chronologically ascending order within each day (PRD C.5: 11:20 before 16:00)
  const sampleLedger: LedgerDay[] = [
    {
      date: todayStr,
      label: formatDayLabel(todayStr, now),
      doings: sampleTodayDoings,
    },
    {
      date: yesterdayStr,
      label: formatDayLabel(yesterdayStr, now),
      doings: [
        {
          id: 'doing_y1',
          what: 'Shipped compiler verification test suite',
          when: '17:30',
          kind: 'action',
          planLink: null,
        },
        {
          id: 'doing_y2',
          what: 'Evening reflection completed on time',
          when: '21:15',
          kind: 'action',
          planLink: null,
        },
      ],
    },
    {
      date: twoDaysAgoStr,
      label: formatDayLabel(twoDaysAgoStr),
      doings: [
        {
          id: 'doing_w2',
          what: 'Reported social media urge and resumed deep work',
          when: '11:20',
          kind: 'impulse_held',
          planLink: null,
        },
        {
          id: 'doing_w1',
          what: 'Completed 4 focus intervals without context switching',
          when: '16:00',
          kind: 'action',
          planLink: null,
        },
      ],
    },
  ];

  // PRD §11 View State: Loading (for initial ledger load)
  if (viewState === 'loading' && activeTab === 'ledger') {
    return (
      <View style={[styles.container, { backgroundColor: canvasBg }]}>
        <View style={[styles.statusNotice, { borderBottomColor: colors.divider }]}>
          <Text
            style={[styles.statusNoticeText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Updating
          </Text>
        </View>
        <Text
          style={[styles.cachedCopy, typeRoles.davosVoice, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Cached figures
        </Text>
      </View>
    );
  }

  // PRD §11 View State: Error / partial failure (for ledger load)
  if (viewState === 'error' && activeTab === 'ledger') {
    return (
      <View style={[styles.container, { backgroundColor: canvasBg }]}>
        <View style={styles.errorContainer}>
          <Text
            style={[styles.errorCopy, typeRoles.meta, { color: colors.danger }]}
            allowFontScaling={true}>
            Can't refresh. Showing data from 14:05.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry refreshing Proof record"
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={loadProof}>
            <Text
              style={[
                styles.actionButtonText,
                typeRoles.davosVoice,
                { color: colors.textPrimary, fontWeight: '500' },
              ]}
              allowFontScaling={true}>
              Retry
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Populated View: Thoughtful Layout with Dual Tabs (Ledger vs Life Metrics)
  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      <ScrollView
        style={styles.scrollArea}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(spacing.md, insets.bottom + spacing.md) },
        ]}>
        {/* 1. Header & Segmented Tab Switcher */}
        <View style={styles.headerBlock}>
          <Text
            style={[styles.screenTitle, typeRoles.heading, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Proof
          </Text>

          <View style={styles.segmentedControlWrap}>
            <SegmentedControl
              options={[
                { value: 'ledger', label: 'Ledger' },
                { value: 'metrics', label: 'Life Metrics' },
              ]}
              value={activeTab}
              onChange={handleTabChange}
              accessibilityLabelPrefix="Proof section"
            />
          </View>
        </View>

        {/* 2. SUB-VIEW A: LEDGER (Oath, 7-Day Numbers, Hourly Records) */}
        {activeTab === 'ledger' && (
          <View style={styles.tabContentBlock}>
            {/* Oath section FIRST (PRD §0, §8 S3, E.2) */}
            {boundOath ? (
              <View style={[styles.sectionContainer, { borderBottomColor: colors.divider }]}>
                <Text
                  style={[styles.sectionHeader, typeRoles.heading, { color: colors.textPrimary }]}
                  allowFontScaling={true}>
                  Oath
                </Text>
                <OathStatement oath={boundOath} state="bound" />
              </View>
            ) : (
              <View style={styles.noOathRow}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="No Oath. Draft one"
                  hitSlop={touchTarget.hitSlop}
                  style={styles.noOathPressable}
                  onPress={() => router.push('/oath')}>
                  <Text
                    style={[styles.noOathText, typeRoles.davosVoice, { color: colors.textSecondary }]}
                    allowFontScaling={true}>
                    No Oath.{' '}
                    <Text style={[styles.draftLink, { color: colors.textPrimary }]}>
                      Draft one
                    </Text>
                  </Text>
                </Pressable>
              </View>
            )}

            {/* "Last 7 days" shows large figures over quiet labels (PRD E.1, E.2) */}
            <View style={[styles.sectionContainer, { borderBottomColor: colors.divider }]}>
              <View style={styles.thisWeekHeaderRow}>
                <Text
                  style={[styles.sectionHeader, typeRoles.heading, { color: colors.textPrimary }]}
                  allowFontScaling={true}>
                  Last 7 days
                </Text>
                <Text
                  style={[styles.rangeLabel, typeRoles.meta, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  {proofMetrics.weekRangeLabel || weekRangeLabel}
                </Text>
              </View>
              <View style={styles.metricsRow}>
                <View style={styles.metricItem}>
                  <Text
                    style={[styles.metricFigure, typeRoles.figureLarge, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    {userId
                      ? proofMetrics.checkinsRatio
                      : proofMetrics.checkinsRatio !== '0 of 0'
                      ? proofMetrics.checkinsRatio
                      : '18 of 20'}
                  </Text>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textSecondary }]}
                    allowFontScaling={true}>
                    check-ins answered
                  </Text>
                </View>
                <View style={styles.metricItem}>
                  <Text
                    style={[styles.metricFigure, typeRoles.figureLarge, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    {userId
                      ? `${proofMetrics.urgesHeld}`
                      : proofMetrics.urgesHeld > 0
                      ? `${proofMetrics.urgesHeld}`
                      : '2'}
                  </Text>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textSecondary }]}
                    allowFontScaling={true}>
                    urges resisted
                  </Text>
                </View>
                <View style={styles.metricItem}>
                  <Text
                    style={[styles.metricFigure, typeRoles.figureLarge, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    {userId
                      ? proofMetrics.onTimePercent
                      : proofMetrics.onTimePercent !== '—'
                      ? proofMetrics.onTimePercent
                      : '85%'}
                  </Text>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textSecondary }]}
                    allowFontScaling={true}>
                    on time
                  </Text>
                </View>
              </View>
            </View>

            {/* Dated ledger (D3, D4, C.5) */}
            <View style={styles.ledgerContainer}>
              {(proofMetrics.ledgerDays.length > 0 ? proofMetrics.ledgerDays : sampleLedger).map(
                (dayGroup) => (
                  <View
                    key={dayGroup.date}
                    style={[styles.ledgerDayGroup, { borderBottomColor: colors.divider }]}>
                    <View style={styles.dayLabelRow}>
                      <Text
                        style={[styles.dayLabel, typeRoles.meta, { color: colors.textSecondary }]}
                        allowFontScaling={true}>
                        {dayGroup.label}
                      </Text>
                    </View>
                    <View style={styles.dayEntriesList}>
                      {dayGroup.doings.map((doing: DoingRecord) => (
                        <DoingLine
                          key={doing.id}
                          what={doing.what}
                          when={doing.when}
                          kind={doing.kind}
                        />
                      ))}
                    </View>
                  </View>
                )
              )}
            </View>
          </View>
        )}

        {/* 3. SUB-VIEW B: LIFE METRICS (Calculated Mathematical Trends & Quests) */}
        {activeTab === 'metrics' && (
          <View style={styles.tabContentBlock}>
            {/* Calm Oath anchor reminder on metrics view */}
            {boundOath && (
              <View style={[styles.oathReminderBar, { borderBottomColor: colors.borderSubtle }]}>
                <Text
                  style={[styles.oathReminderPrefix, typeRoles.meta, { color: colors.textTertiary }]}
                  allowFontScaling={true}>
                  BOUND OATH ·{' '}
                </Text>
                <Text
                  style={[styles.oathReminderText, typeRoles.meta, { color: colors.textSecondary }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling={true}>
                  "{boundOath.commitmentText}"
                </Text>
              </View>
            )}

            {/* Canonical Life Metrics Panel */}
            <MetricsPanel
              views={metricViews}
              isLoading={metricsLoading}
              isRefreshing={metricsRefreshing}
              errorMessage={metricsError}
              onRefresh={() => void loadMetricsData(true)}
              lastUpdated={lastMetricsUpdate}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  headerBlock: {
    gap: spacing.sm,
    paddingBottom: spacing.xxs,
  },
  screenTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  segmentedControlWrap: {
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: 320,
  },
  tabContentBlock: {
    width: '100%',
    gap: spacing.md,
  },
  statusNotice: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusNoticeText: {
    paddingHorizontal: spacing.none,
  },
  cachedCopy: {
    padding: spacing.md,
  },
  errorContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorCopy: {
    paddingHorizontal: spacing.none,
  },
  sectionContainer: {
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  thisWeekHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  rangeLabel: {
    paddingHorizontal: spacing.none,
  },
  sectionHeader: {
    paddingBottom: spacing.xxs,
  },
  noOathRow: {
    paddingVertical: spacing.xs,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  noOathPressable: {
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  noOathText: {
    paddingHorizontal: spacing.none,
  },
  draftLink: {
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingVertical: spacing.xxs,
  },
  metricItem: {
    gap: spacing.xxs,
  },
  metricFigure: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
  },
  metricLabel: {
    paddingHorizontal: spacing.none,
  },
  ledgerContainer: {
    gap: spacing.sm,
  },
  ledgerDayGroup: {
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  dayLabelRow: {
    paddingVertical: spacing.xxs,
  },
  dayLabel: {
    paddingHorizontal: spacing.none,
  },
  dayEntriesList: {
    gap: spacing.xxs,
  },
  actionButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  actionButtonText: {
    paddingHorizontal: spacing.none,
  },
  oathReminderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  oathReminderPrefix: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  oathReminderText: {
    fontSize: 12,
    flex: 1,
    fontStyle: 'italic',
  },
});
