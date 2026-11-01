// app/(app)/today.tsx
// Screen S2 (Today) — Plan against actual (PRD §0, §3, §8, §11, §12; BREADBOARD S2).
// Renders the shared StatusLine, Plan items with StatusMark, in-place plan editing (PlanList),
// and quieter logged entries under each plan item.
// Uses only theme/roles.ts. RN primitives only. No cards, no elevation.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import {
  DoingRecord,
  PlanItem,
  groupDoingsByPlan,
  sampleTodayDoings,
  sampleTodayPlanItems,
} from '../../fixtures/davos';
import { computeCheckinStatus } from '../../lib/checkinCounts';
import { PlanList } from '../../components/davos/PlanList';
import { DoingLine } from '../../components/davos/DoingLine';
import { StatusLine } from '../../components/davos/StatusLine';
import { SampleDataMarker } from '../../components/davos/SampleDataMarker';

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';

export default function TodayScreen() {
  const { colors } = useTheme();
  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [planItems, setPlanItems] = useState<PlanItem[]>(sampleTodayPlanItems);
  const [doings, setDoings] = useState<DoingRecord[]>(sampleTodayDoings);

  // Add first item for empty state recovery (PRD §11 Today)
  const handleAddFirstItem = () => {
    const newItem: PlanItem = {
      id: `today_${Date.now()}`,
      text: 'First plan item',
      time: '09:00',
      order: 1,
      status: 'pending',
    };
    setPlanItems([newItem]);
    setViewState('populated');
  };

  // Plan editing confirmation: keep changes in local state (no backend endpoint)
  const handleConfirmPlan = (confirmed: PlanItem[]) => {
    setPlanItems(confirmed);
  };

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
          Cached
        </Text>
      </View>
    );
  }

  // PRD §11 View State: Empty ("No plan for today. Set one now." + [Add first item])
  if (viewState === 'empty') {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.emptyContainer}>
          <Text
            style={[styles.emptyCopy, typeRoles.davosVoice, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            No plan for today. Set one now.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add first plan item"
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={handleAddFirstItem}>
            <Text
              style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Add first item
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // PRD §11 View State: Error ("Can't refresh. Showing data from 14:05.")
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
            accessibilityLabel="Retry refreshing Today view"
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={() => setViewState('populated')}>
            <Text
              style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Retry
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Canonical grouping shared with TodayPanel (PRD C.4)
  const { planGroups, unlinkedDoings } = groupDoingsByPlan(planItems, doings);
  const pendingPlanItem = planItems.find(
    (item) => item.status === 'pending' && item.time !== '20:30'
  );
  const statusCounts = computeCheckinStatus(planItems, {
    dueInterval: pendingPlanItem ? pendingPlanItem.time : undefined,
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* 1. Shared status line (PRD §8, A9, B.7, C.1, C.2: shows on Davos and Today only) */}
      <StatusLine
        nextCheckIn={statusCounts.nextOrDue.time}
        dueNow={statusCounts.nextOrDue.isDue ? statusCounts.nextOrDue.time : undefined}
        isPending={statusCounts.nextOrDue.isDue}
        progress={statusCounts.progressText}
        syncState="normal"
      />

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.content}>
        {/* 2. Plan items and editing (reusing PlanList, PRD §8 S2, C2, C4) */}
        <PlanList
          title="Plan"
          initialItems={planItems}
          isLockedInitially={true}
          onConfirm={handleConfirmPlan}
          renderAfterItem={(item) => {
            const group = planGroups.find((g) => g.planItem.id === item.id);
            const itemDoings = group ? group.doings : [];
            if (itemDoings.length === 0) return null;
            return (
              <View style={styles.itemDoingsContainer}>
                {itemDoings.map((doing) => (
                  <DoingLine
                    key={doing.id}
                    doing={doing}
                  />
                ))}
              </View>
            );
          }}
        />

        {/* 3. Also logged entries (renamed from "Other Doings", C2, C4) */}
        {unlinkedDoings.length > 0 && (
          <View style={styles.unlinkedSection}>
            <Text
              style={[styles.unlinkedTitle, typeRoles.heading, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Also logged
            </Text>
            <View style={styles.unlinkedList}>
              {unlinkedDoings.map((doing) => (
                <DoingLine
                  key={doing.id}
                  doing={doing}
                />
              ))}
            </View>
          </View>
        )}

        <SampleDataMarker screen="Today" />
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
    gap: spacing.sm,
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
  itemDoingsContainer: {
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
  },
  unlinkedSection: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  unlinkedTitle: {
    paddingBottom: spacing.xxs,
  },
  unlinkedList: {
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
