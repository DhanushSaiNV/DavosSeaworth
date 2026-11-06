// app/(app)/proof.tsx
// Screen S3 (Proof) — Evidence: Oath section first, "this week" figures with quiet labels, dated ledger.
// Refs: design/DESIGN_PRD.md §0, §8, §11, §12, §13, §14; design/ORCA.md §1; design/BREADBOARD.md
// Rules: No cards, no elevation, no KPI card rows (PRD §14 #1, #5), no streak art/badges (PRD §14 #4).
// Uses only theme/roles.ts. RN primitives only.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import {
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

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';

export default function ProofScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;

  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [boundOath, setBoundOath] = useState<BoundOath | null>(null);
  const [metrics, setMetrics] = useState<ProofMetrics>({
    checkinsRatio: '0 of 0',
    onTimePercent: '—',
    urgesHeld: 0,
    weekRangeLabel: '',
    ledgerDays: [],
  });

  const { snapshot } = useDayContext();

  // Load bound oath & proof data on mount and tab re-focus (B.4)
  const loadProof = useCallback(() => {
    oathAdapter.getBoundOath().then((oath) => {
      setBoundOath(oath);
    });

    if (userId) {
      setViewState('loading');
      fetchProofData(userId, snapshot.now)
        .then((res) => {
          setMetrics(res);
          setViewState(res.ledgerDays.length > 0 ? 'populated' : 'empty');
        })
        .catch(() => {
          setViewState('error');
        });
    } else {
      setViewState('populated');
    }
  }, [userId, snapshot.now]);

  useFocusEffect(
    useCallback(() => {
      loadProof();
    }, [loadProof])
  );

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

  // PRD §11 View State: Loading
  if (viewState === 'loading') {
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

  // PRD §11 View State: Empty
  if (viewState === 'empty') {
    return (
      <View style={[styles.container, { backgroundColor: canvasBg }]}>
        <View style={styles.emptyContainer}>
          <Text
            style={[styles.emptyCopy, typeRoles.davosVoice, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Nothing here yet. Your first answered check-in starts the record.
          </Text>
        </View>
      </View>
    );
  }

  // PRD §11 View State: Error / partial failure
  if (viewState === 'error') {
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
              style={[styles.actionButtonText, typeRoles.davosVoice, { color: colors.textPrimary, fontWeight: '500' }]}
              allowFontScaling={true}>
              Retry
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // PRD §11 View State: Populated (Oath section first, "this week" as plain lines, dated ledger)
  // No status line on Proof (AU32, PRD Step 0)
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
        {/* 1. Oath section FIRST (PRD §0, §8 S3, E.2) */}
        {boundOath ? (
          <View style={[styles.sectionContainer, { borderBottomColor: colors.divider }]}>
            <Text
              style={[styles.sectionHeader, typeRoles.heading, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Oath
            </Text>
            <OathStatement
              oath={boundOath}
              state="bound"
            />
          </View>
        ) : (
          /* With no Oath: remove heading and divider, show one ~44px row (PRD E.2) */
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

        {/* 2. "Last 7 days" shows large figures over quiet labels (PRD E.1, E.2) */}
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
              {metrics.weekRangeLabel || weekRangeLabel}
            </Text>
          </View>
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text
                style={[styles.metricFigure, typeRoles.figureLarge, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                {userId
                  ? metrics.checkinsRatio
                  : metrics.checkinsRatio !== '0 of 0'
                  ? metrics.checkinsRatio
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
                  ? `${metrics.urgesHeld}`
                  : metrics.urgesHeld > 0
                  ? `${metrics.urgesHeld}`
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
                  ? metrics.onTimePercent
                  : metrics.onTimePercent !== '—'
                  ? metrics.onTimePercent
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

        {/* 3. Dated ledger (D3, D4, C.5) */}
        <View style={styles.ledgerContainer}>
          <Text
            style={[styles.sectionHeader, typeRoles.heading, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Ledger
          </Text>

          {(userId
            ? metrics.ledgerDays
            : metrics.ledgerDays.length > 0
            ? metrics.ledgerDays
            : sampleLedger
          ).map((day) => (
            <View
              key={day.date}
              style={[styles.ledgerDayGroup, { borderBottomColor: colors.divider }]}>
              {/* Day heading: smaller and quieter than section headings (D3) */}
              <View style={styles.dayLabelRow}>
                <Text
                  style={[styles.dayLabel, typeRoles.meta, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  {day.label}
                </Text>
              </View>

              {/* Ledger entries with spacing and no per-row hairlines (D4) */}
              <View style={styles.dayEntriesList}>
                {day.doings.map((doing) => (
                  <DoingLine key={doing.id} doing={doing} />
                ))}
              </View>
            </View>
          ))}
        </View>
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    gap: spacing.md,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
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
  emptyContainer: {
    padding: spacing.md,
  },
  emptyCopy: {
    paddingHorizontal: spacing.none,
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
  },
  actionButtonText: {
    paddingHorizontal: spacing.none,
  },
});
