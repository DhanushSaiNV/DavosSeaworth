// components/davos/PlanList.tsx
// Canonical container for Object: Plan (PRD §3, §11, §12; BREADBOARD F3; design/DESIGN.md §6).
// Props: items, onConfirm
// States: empty, loading, populated, error
// Manages inline-editable Plan items with reorder, add, remove, and [Confirm plan].
// Uses only theme/roles.ts. RN primitives only.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { PlanItem } from '../../fixtures/davos';
import { PlanItemRow } from './PlanItemRow';

export interface PlanListProps {
  initialItems?: PlanItem[];
  items?: PlanItem[];
  onConfirm?: (confirmedItems: PlanItem[]) => void;
  isLockedInitially?: boolean;
  state?: 'empty' | 'loading' | 'populated' | 'error';
  colorScheme?: 'light' | 'dark';
  title?: string;
  renderAfterItem?: (item: PlanItem) => React.ReactNode;
}

export function PlanList({
  initialItems = [],
  items: propItems,
  onConfirm,
  isLockedInitially = false,
  state = 'populated',
  colorScheme = 'light',
  title,
  renderAfterItem,
}: PlanListProps) {
  const colors = colorRoles[colorScheme];
  const [items, setItems] = useState<PlanItem[]>(propItems ?? initialItems);
  const [isLocked, setIsLocked] = useState<boolean>(isLockedInitially);

  // 1. State: loading (PRD §11)
  if (state === 'loading') {
    return (
      <View style={[styles.container, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.stateNotice, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Cached
        </Text>
      </View>
    );
  }

  // 2. State: empty (PRD §11 copy: "Nothing planned. Give me tomorrow's three things.")
  if (state === 'empty' || items.length === 0) {
    return (
      <View style={[styles.container, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.stateNotice, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Nothing planned. Give me tomorrow's three things.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add first plan item"
          hitSlop={touchTarget.hitSlop}
          style={[styles.actionButton, { borderColor: colors.divider }]}
          onPress={() => {
            const newItem: PlanItem = {
              id: `plan_${Date.now()}`,
              text: 'Tomorrow item',
              time: '09:00',
              order: 1,
              status: 'pending',
            };
            setItems([newItem]);
          }}>
          <Text
            style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Add first item
          </Text>
        </Pressable>
      </View>
    );
  }

  // 3. State: error (PRD §11 copy: "Not synced")
  if (state === 'error') {
    return (
      <View style={[styles.container, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.stateNotice, typeRoles.meta, { color: colors.danger }]}
          allowFontScaling={true}>
          Edit failed: local edit kept, "Not synced"
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry syncing plan"
          hitSlop={touchTarget.hitSlop}
          style={[styles.actionButton, { borderColor: colors.divider }]}
          onPress={() => onConfirm?.(items)}>
          <Text
            style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Retry sync
          </Text>
        </Pressable>
      </View>
    );
  }

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

  // 4. State: populated (default interactive list)
  return (
    <View style={styles.container}>
      <Text
        style={[styles.sectionHeader, typeRoles.heading, { color: colors.textPrimary }]}
        allowFontScaling={true}>
        {title ?? (isLocked ? 'Plan' : 'Edit Plan')}
      </Text>

      {/* List of PlanItemRows */}
      <View style={styles.list}>
        {items.map((item, index) => (
          <View
            key={item.id}
            style={[
              styles.itemGroup,
              { borderBottomColor: colors.divider },
            ]}>
            <PlanItemRow
              item={item}
              isEditing={!isLocked}
              onPress={isLocked ? () => setIsLocked(false) : undefined}
              onTextChange={(text) => handleTextChange(index, text)}
              onTimeChange={(time) => handleTimeChange(index, time)}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
              onRemove={() => handleRemove(index)}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
              colorScheme={colorScheme}
            />
            {renderAfterItem ? renderAfterItem(item) : null}
          </View>
        ))}
      </View>

      {/* In-place editing controls */}
      {!isLocked ? (
        <View style={styles.controlsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add plan item"
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={handleAdd}>
            <Text
              style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Add item
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm plan"
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={handleConfirm}>
            <Text
              style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Confirm plan
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.controlsRow}>
          <Text
            style={[styles.lockedText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Plan confirmed. Tap any row to edit.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit plan"
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={() => setIsLocked(false)}>
            <Text
              style={[styles.actionButtonText, typeRoles.meta, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Edit plan
            </Text>
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
  stateNotice: {
    paddingVertical: spacing.xs,
  },
  list: {
    gap: spacing.xxs,
  },
  itemGroup: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.xs,
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
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButtonText: {
    paddingHorizontal: spacing.none,
  },
  lockedText: {
    paddingHorizontal: spacing.none,
  },
});
