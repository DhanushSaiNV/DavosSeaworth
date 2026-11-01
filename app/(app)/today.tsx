// app/(app)/today.tsx
// Screen S2 (Today) — Plan against actual (PRD §0, §3, §8, §11, §12; BREADBOARD S2).
// Renders the next check-in line, Plan items with status, and Doings logged under each item.
// PlanItemRow (time at left) and DoingLine (time at right) are two distinct canonical elements.
// Uses only theme/roles.ts. RN primitives only. No cards, no elevation.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import {
  DoingRecord,
  PlanItem,
  initialStatusLine,
  sampleTodayDoings,
  sampleTodayPlanItems,
} from '../../fixtures/davos';
import { PlanItemRow } from '../../components/davos/PlanItemRow';
import { DoingLine } from '../../components/davos/DoingLine';

type ViewMode = 'populated' | 'empty' | 'loading' | 'error';

export default function TodayScreen() {
  const colors = colorRoles.light;
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
            style={[styles.actionButton, { borderColor: colors.accent }]}
            onPress={handleAddFirstItem}>
            <Text
              style={[styles.actionButtonText, typeRoles.meta, { color: colors.accent }]}
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

  // Separate unlinked Doings
  const unlinkedDoings = doings.filter((d) => !d.planLink);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surface }]}
      contentContainerStyle={styles.content}>
      {/* 1. Next check-in line at top (PRD §8 S2: Docked next check-in line) */}
      <View style={[styles.nextCheckInContainer, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.nextCheckInText, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Next check-in {initialStatusLine.nextCheckIn} · {initialStatusLine.progress}
        </Text>
      </View>

      {/* 2. Plan items with Doings logged under each item (PRD §8, PRD §3) */}
      <View style={styles.planSection}>
        <Text
          style={[styles.sectionTitle, typeRoles.heading, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          Today’s Plan & Doings
        </Text>

        {planItems.map((item) => {
          const itemDoings = doings.filter((d) => d.planLink === item.id);
          return (
            <View
              key={item.id}
              style={[styles.itemGroup, { borderBottomColor: colors.divider }]}>
              {/* PlanItemRow: Intention, time at LEFT */}
              <PlanItemRow
                item={item}
                isEditing={false}
                colorScheme="light"
              />

              {/* DoingLines: Facts logged under this Plan item, time at RIGHT */}
              {itemDoings.map((doing) => (
                <View key={doing.id} style={styles.doingIndent}>
                  <DoingLine
                    doing={doing}
                    colorScheme="light"
                  />
                </View>
              ))}
            </View>
          );
        })}

        {/* Any Doings not linked to a specific plan item */}
        {unlinkedDoings.length > 0 && (
          <View style={styles.unlinkedSection}>
            <Text
              style={[styles.unlinkedTitle, typeRoles.meta, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              Other Doings
            </Text>
            {unlinkedDoings.map((doing) => (
              <View key={doing.id} style={styles.doingIndent}>
                <DoingLine
                  doing={doing}
                  colorScheme="light"
                />
              </View>
            ))}
          </View>
        )}
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
    gap: spacing.sm,
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
  nextCheckInContainer: {
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nextCheckInText: {
    fontSize: 13,
  },
  planSection: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    paddingBottom: spacing.xxs,
  },
  itemGroup: {
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xxs,
  },
  doingIndent: {
    paddingLeft: spacing.sm,
  },
  unlinkedSection: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  unlinkedTitle: {
    fontSize: 13,
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
