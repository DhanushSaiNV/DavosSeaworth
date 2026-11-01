// app/(app)/proof.tsx
// Screen S3 (Proof) — Evidence: Oath section first, "this week" plain lines, dated ledger.
// Refs: design/DESIGN_PRD.md §0, §8, §11, §12, §13, §14; design/ORCA.md §1; design/BREADBOARD.md
// Rules: No cards, no elevation, no KPI card rows (PRD §14 #1, #5), no streak art/badges (PRD §14 #4).
// Uses only theme/roles.ts. RN primitives only.

import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { BoundOath, oathAdapter } from '../../lib/oathAdapter';
import { DoingRecord, sampleTodayDoings } from '../../fixtures/davos';
import { OathStatement } from '../../components/davos/OathStatement';
import { DoingLine } from '../../components/davos/DoingLine';

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';

interface LedgerDay {
  date: string;
  label: string;
  doings: DoingRecord[];
}

export default function ProofScreen() {
  const router = useRouter();
  const colors = colorRoles.light; // Shell/system default

  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [boundOath, setBoundOath] = useState<BoundOath | null>(null);

  // Load bound oath from adapter
  useEffect(() => {
    oathAdapter.getBoundOath().then((oath) => {
      setBoundOath(oath);
    });
  }, []);

  // Sample ledger history (PRD §8 dated ledger)
  const sampleLedger: LedgerDay[] = [
    {
      date: '2026-11-01',
      label: 'Today · Nov 1',
      doings: sampleTodayDoings,
    },
    {
      date: '2026-10-31',
      label: 'Yesterday · Oct 31',
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
          what: 'Morning reflection completed on time',
          when: '08:15',
          kind: 'action',
          planLink: null,
        },
      ],
    },
    {
      date: '2026-10-30',
      label: 'Wednesday · Oct 30',
      doings: [
        {
          id: 'doing_w1',
          what: 'Completed 4 focus intervals without context switching',
          when: '16:00',
          kind: 'action',
          planLink: null,
        },
        {
          id: 'doing_w2',
          what: 'Reported social media urge and resumed deep work',
          when: '11:20',
          kind: 'impulse_held',
          planLink: null,
        },
      ],
    },
  ];

  // PRD §11 View State: Loading
  if (viewState === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
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
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
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
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
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
            style={[styles.actionButton, { borderColor: colors.accent }]}
            onPress={() => setViewState('populated')}>
            <Text
              style={[styles.actionButtonText, typeRoles.meta, { color: colors.accent }]}
              allowFontScaling={true}>
              Retry
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // PRD §11 View State: Populated (Oath section first, "this week" as plain lines, dated ledger)
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surface }]}
      contentContainerStyle={styles.content}>
      {/* 1. Oath section FIRST (PRD §0, §8 S3) */}
      <View style={[styles.sectionContainer, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.sectionHeader, typeRoles.heading, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          Oath
        </Text>

        {boundOath ? (
          <OathStatement
            oath={boundOath}
            state="bound"
            colorScheme="light"
          />
        ) : (
          <View style={styles.noOathRow}>
            <Text
              style={[styles.noOathText, typeRoles.davosVoice, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              No Oath. It can't be undone. Start one when you're sure.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Draft an Oath"
              hitSlop={touchTarget.hitSlop}
              style={[styles.actionButton, { borderColor: colors.accent }]}
              onPress={() => router.push('/oath')}>
              <Text
                style={[styles.actionButtonText, typeRoles.meta, { color: colors.accent }]}
                allowFontScaling={true}>
                Draft an Oath
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* 2. "This week" as plain lines (PRD §8, §14 #4 & #5: plain typographic lines, no cards, no badges) */}
      <View style={[styles.sectionContainer, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.sectionHeader, typeRoles.heading, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          This week
        </Text>
        <View style={styles.plainLinesList}>
          <Text
            style={[styles.plainLine, typeRoles.meta, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            18 of 20 check-ins answered (90%)
          </Text>
          <Text
            style={[styles.plainLine, typeRoles.meta, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            2 urges reported · 2 resisted
          </Text>
          <Text
            style={[styles.plainLine, typeRoles.meta, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            4 days on plan
          </Text>
        </View>
      </View>

      {/* 3. Dated ledger (PRD §8 S3 dated ledger) */}
      <View style={styles.ledgerContainer}>
        <Text
          style={[styles.sectionHeader, typeRoles.heading, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          Ledger
        </Text>

        {sampleLedger.map((day) => (
          <View
            key={day.date}
            style={[styles.ledgerDayGroup, { borderBottomColor: colors.divider }]}>
            <View style={styles.dayLabelRow}>
              <Text
                style={[styles.dayLabel, typeRoles.heading, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                {day.label}
              </Text>
            </View>

            {day.doings.map((doing) => (
              <View key={doing.id} style={styles.doingRowWrapper}>
                <DoingLine doing={doing} colorScheme="light" />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  statusNotice: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusNoticeText: {
    fontSize: 13,
  },
  cachedCopy: {
    padding: spacing.md,
    fontSize: 15,
  },
  emptyContainer: {
    padding: spacing.md,
  },
  emptyCopy: {
    fontSize: 15,
    lineHeight: 22,
  },
  errorContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorCopy: {
    fontSize: 13,
  },
  sectionContainer: {
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  sectionHeader: {
    fontSize: 16,
    paddingBottom: spacing.xxs,
  },
  noOathRow: {
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  noOathText: {
    fontSize: 14,
    lineHeight: 20,
  },
  plainLinesList: {
    paddingVertical: spacing.xxs,
    gap: spacing.xxs,
  },
  plainLine: {
    fontSize: 14,
    lineHeight: 22,
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
    fontSize: 14,
  },
  doingRowWrapper: {
    paddingVertical: spacing.none,
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
    fontSize: 14,
    fontWeight: '600',
  },
});
