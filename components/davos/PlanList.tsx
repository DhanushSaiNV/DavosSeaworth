// components/davos/PlanList.tsx
// Canonical container for Object: Plan (PRD §3, §11, §12; BREADBOARD F3; design/DESIGN.md §6).
// Props: items, onConfirm
// States: empty, loading, populated, error
// Manages inline-editable Plan items with reorder, add, remove, and [Confirm plan].
// Uses theme hook (PRD Step 0, A.2, AU37). RN primitives only.
// Edit mode: borderless underlined inputs, + Add item text row at end, Confirm plan single bordered button
// disabled until changed, Undo toast on remove, Enter in title adds row below (PRD E.1, E.2, E.3, E.4).

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { PlanItem } from '../../fixtures/davos';
import { PlanItemRow } from './PlanItemRow';
import { UndoToast } from './UndoToast';
import { Icon } from '../ui/Icon';

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
  colorScheme,
  title,
  renderAfterItem,
}: PlanListProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  const [items, setItems] = useState<PlanItem[]>(propItems ?? initialItems);
  const [isLocked, setIsLocked] = useState<boolean>(isLockedInitially);

  // Undo removal state (PRD E.1)
  const [removedItemInfo, setRemovedItemInfo] = useState<{
    item: PlanItem;
    index: number;
  } | null>(null);

  // Sync propItems when provided
  useEffect(() => {
    if (propItems) {
      setItems(propItems);
    }
  }, [propItems]);

  // Dirty check: Confirm plan disabled until something changed (PRD E.3)
  const isDirty =
    items.length !== initialItems.length ||
    items.some(
      (it, idx) =>
        it.text !== initialItems[idx]?.text ||
        it.time !== initialItems[idx]?.time ||
        it.order !== initialItems[idx]?.order
    );

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
          style={[styles.confirmButton, { borderColor: colors.controlBorder }]}
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
            style={[styles.confirmButtonText, typeRoles.meta, { color: colors.textPrimary }]}
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
          style={[styles.confirmButton, { borderColor: colors.controlBorder }]}
          onPress={() => onConfirm?.(items)}>
          <Text
            style={[styles.confirmButtonText, typeRoles.meta, { color: colors.textPrimary }]}
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

  // Remove item and show undo toast (PRD E.1)
  const handleRemove = (index: number) => {
    const itemToRemove = items[index];
    setRemovedItemInfo({ item: itemToRemove, index });
    setItems((prev) => {
      const copy = prev.filter((_, i) => i !== index);
      return copy.map((item, idx) => ({ ...item, order: idx + 1 }));
    });
  };

  // Undo remove handler (PRD E.1)
  const handleUndoRemove = () => {
    if (!removedItemInfo) return;
    setItems((prev) => {
      const copy = [...prev];
      copy.splice(removedItemInfo.index, 0, removedItemInfo.item);
      return copy.map((item, idx) => ({ ...item, order: idx + 1 }));
    });
    setRemovedItemInfo(null);
  };

  // Add new item (PRD E.3)
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

  // Enter in title adds a new row below (PRD E.4)
  const handleEnterTitle = (index: number) => {
    const newItem: PlanItem = {
      id: `plan_user_${Date.now()}`,
      text: '',
      time: '12:00',
      order: index + 2,
      status: 'pending',
    };
    setItems((prev) => {
      const copy = [...prev];
      copy.splice(index + 1, 0, newItem);
      return copy.map((it, idx) => ({ ...it, order: idx + 1 }));
    });
  };

  // Confirm plan action (BREADBOARD F3, PRD E.3)
  const handleConfirm = () => {
    setIsLocked(true);
    onConfirm?.(items);
  };

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
              onEnterTitle={() => handleEnterTitle(index)}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
            />
            {renderAfterItem ? renderAfterItem(item) : null}
          </View>
        ))}
      </View>

      {/* Undo Toast on row removal (PRD E.1: "Removed. Undo") */}
      {removedItemInfo && (
        <UndoToast
          label="Removed."
          timeout={8}
          onUndo={handleUndoRemove}
          onExpire={() => setRemovedItemInfo(null)}
        />
      )}

      {/* In-place editing controls */}
      {!isLocked ? (
        <View style={styles.controlsRow}>
          {/* PRD E.3, D.2: "Add item" is body size, textPrimary, with a plus icon */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add item"
            hitSlop={touchTarget.hitSlop}
            style={styles.addItemRow}
            onPress={handleAdd}>
            <Icon name="plus" size="sm" color={colors.textPrimary} />
            <Text
              style={[styles.addItemText, typeRoles.userText, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Add item
            </Text>
          </Pressable>

          {/* PRD E.3, D.2: "Confirm plan" bordered like "Edit plan"; when disabled, hint "No changes" beside it */}
          <View style={styles.confirmGroup}>
            {!isDirty && (
              <Text
                style={[styles.noChangesHint, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                No changes
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm plan"
              disabled={!isDirty}
              hitSlop={touchTarget.hitSlop}
              style={[
                styles.confirmButton,
                {
                  borderColor: isDirty ? colors.controlBorder : colors.divider,
                },
              ]}
              onPress={handleConfirm}>
              <Text
                style={[
                  styles.confirmButtonText,
                  typeRoles.meta,
                  { color: isDirty ? colors.textPrimary : colors.disabled },
                ]}
                allowFontScaling={true}>
                Confirm plan
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.controlsRow}>
          <Text
            style={[styles.lockedText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Plan confirmed.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit plan"
            hitSlop={touchTarget.hitSlop}
            style={[styles.confirmButton, { borderColor: colors.controlBorder }]}
            onPress={() => setIsLocked(false)}>
            <Text
              style={[styles.confirmButtonText, typeRoles.meta, { color: colors.textPrimary }]}
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
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  addItemRow: {
    minHeight: touchTarget.minTargetIos,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
  },
  addItemText: {
    paddingHorizontal: spacing.none,
  },
  confirmGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  noChangesHint: {
    paddingHorizontal: spacing.none,
  },
  confirmButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  confirmButtonText: {
    paddingHorizontal: spacing.none,
  },
  lockedText: {
    paddingHorizontal: spacing.none,
  },
});
