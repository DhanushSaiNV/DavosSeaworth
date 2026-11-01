// app/(app)/today.tsx
// Screen S2 (Today) — Plan against actual (PRD §0, §3, §8, §11, §12; BREADBOARD S2).
// Renders the next check-in line, Plan items with status, and Doings logged under each item.
// PlanItemRow (time at left) and DoingLine (time at right) are two distinct canonical elements.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { spacing, touchTarget } from '../../theme/tokens/spacing';
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
  const [viewState, setViewState] = useState<ViewMode>('populated');
  const [planItems, setPlanItems] = useState<PlanItem[]>(sampleTodayPlanItems);
  const [doings, setDoings] = useState<DoingRecord[]>(sampleTodayDoings);

  // Add first item for empty state recovery
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

  // View state copy per PRD §11
  if (viewState === 'loading') {
    return (
      <View style={styles.container}>
        <Text style={styles.stateText}>Cached</Text>
      </View>
    );
  }

  if (viewState === 'empty') {
    return (
      <View style={styles.container}>
        <Text style={styles.stateText}>No plan for today. Set one now.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add first plan item"
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={handleAddFirstItem}>
          <Text>Add first item</Text>
        </Pressable>
      </View>
    );
  }

  if (viewState === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.stateText}>Can't refresh. Showing data from 14:05.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry refreshing Today view"
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={() => setViewState('populated')}>
          <Text>Retry</Text>
        </Pressable>
      </View>
    );
  }

  // Separate unlinked Doings
  const unlinkedDoings = doings.filter((d) => !d.planLink);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 1. Next check-in line at top (PRD §8) */}
      <View style={styles.nextCheckInContainer}>
        <Text style={styles.nextCheckInText}>
          Next check-in {initialStatusLine.nextCheckIn} · {initialStatusLine.progress}
        </Text>
      </View>

      {/* 2. Plan items with Doings logged under each item (PRD §8, PRD §3) */}
      <View style={styles.planSection}>
        <Text style={styles.sectionTitle}>Today’s Plan & Doings</Text>

        {planItems.map((item) => {
          const itemDoings = doings.filter((d) => d.planLink === item.id);
          return (
            <View key={item.id} style={styles.itemGroup}>
              {/* PlanItemRow: Intention, time at LEFT */}
              <PlanItemRow item={item} isEditing={false} />

              {/* DoingLines: Facts logged under this Plan item, time at RIGHT */}
              {itemDoings.map((doing) => (
                <DoingLine key={doing.id} doing={doing} />
              ))}
            </View>
          );
        })}

        {/* Any Doings not linked to a specific plan item */}
        {unlinkedDoings.length > 0 && (
          <View style={styles.unlinkedSection}>
            <Text style={styles.unlinkedTitle}>Other Doings</Text>
            {unlinkedDoings.map((doing) => (
              <DoingLine key={doing.id} doing={doing} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// Layout only using spacing scale tokens; zero colours, borders, elevation, or custom fonts
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  nextCheckInContainer: {
    paddingVertical: spacing.xs,
  },
  nextCheckInText: {
    paddingHorizontal: spacing.none,
  },
  planSection: {
    gap: spacing.sm,
  },
  sectionTitle: {
    paddingVertical: spacing.xxs,
  },
  itemGroup: {
    gap: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  unlinkedSection: {
    gap: spacing.xxs,
    paddingTop: spacing.xs,
  },
  unlinkedTitle: {
    paddingVertical: spacing.xxs,
  },
  stateText: {
    paddingVertical: spacing.md,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
