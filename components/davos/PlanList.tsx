// components/davos/PlanList.tsx
// Canonical container for Object: Plan (PRD §3, §12, BREADBOARD F3).
// Manages inline-editable Plan items with reorder, add, remove, and [Confirm plan].

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spacing, touchTarget } from '../../theme/tokens/spacing';
import { PlanItem } from '../../fixtures/davos';
import { PlanItemRow } from './PlanItemRow';

export interface PlanListProps {
  initialItems: PlanItem[];
  onConfirm?: (confirmedItems: PlanItem[]) => void;
  isLockedInitially?: boolean;
}

export function PlanList({
  initialItems,
  onConfirm,
  isLockedInitially = false,
}: PlanListProps) {
  const [items, setItems] = useState<PlanItem[]>(initialItems);
  const [isLocked, setIsLocked] = useState<boolean>(isLockedInitially);

  // Update text of an item
  const handleTextChange = (index: number, newText: string) => {
    setItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], text: newText };
      return copy;
    });
  };

  // Update time of an item
  const handleTimeChange = (index: number, newTime: string) => {
    setItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], time: newTime };
      return copy;
    });
  };

  // Reorder item up (no drag per PRD §13)
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setItems((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = { ...copy[index], order: index };
      copy[index] = { ...temp, order: index + 1 };
      return copy;
    });
  };

  // Reorder item down (no drag per PRD §13)
  const handleMoveDown = (index: number) => {
    if (index >= items.length - 1) return;
    setItems((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = { ...copy[index], order: index + 2 };
      copy[index] = { ...temp, order: index + 1 };
      return copy;
    });
  };

  // Remove item
  const handleRemove = (index: number) => {
    setItems((prev) => {
      const copy = prev.filter((_, i) => i !== index);
      return copy.map((item, idx) => ({ ...item, order: idx + 1 }));
    });
  };

  // Add new item
  const handleAdd = () => {
    const newItem: PlanItem = {
      id: `plan_user_${Date.now()}`,
      text: '',
      time: '12:00',
      order: items.length + 1,
      status: 'pending',
    };
    setItems((prev) => [...prev, newItem]);
  };

  // Confirm plan action (BREADBOARD F3)
  const handleConfirm = () => {
    setIsLocked(true);
    onConfirm?.(items);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>
        {isLocked ? 'Confirmed Plan' : 'Tomorrow’s Plan'}
      </Text>

      {/* List of PlanItemRows */}
      <View style={styles.list}>
        {items.map((item, index) => (
          <PlanItemRow
            key={item.id}
            item={item}
            isEditing={!isLocked}
            onTextChange={(text) => handleTextChange(index, text)}
            onTimeChange={(time) => handleTimeChange(index, time)}
            onMoveUp={() => handleMoveUp(index)}
            onMoveDown={() => handleMoveDown(index)}
            onRemove={() => handleRemove(index)}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
          />
        ))}
      </View>

      {/* In-place editing controls */}
      {!isLocked ? (
        <View style={styles.controlsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add plan item"
            hitSlop={touchTarget.hitSlop}
            style={styles.actionButton}
            onPress={handleAdd}>
            <Text>Add item</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm plan"
            hitSlop={touchTarget.hitSlop}
            style={styles.actionButton}
            onPress={handleConfirm}>
            <Text>Confirm plan</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.controlsRow}>
          <Text style={styles.lockedText}>Plan locked.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit plan"
            hitSlop={touchTarget.hitSlop}
            style={styles.actionButton}
            onPress={() => setIsLocked(false)}>
            <Text>Edit</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  sectionHeader: {
    paddingVertical: spacing.xxs,
  },
  list: {
    gap: spacing.xxs,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockedText: {
    paddingHorizontal: spacing.none,
  },
});
