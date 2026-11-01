// components/davos/TodayPanel.tsx
// Canonical component for Object: Shell wide docked panel (PRD §0, §6, §8, §12; design/DESIGN.md §6).
// Width >= 1200dp: Docked Today panel flush to the edge (~ nice-to-have per PRD §6).
// Props: items
// States: selected (expanded), collapsed
// Four view states: empty, loading, populated, error (PRD §12 copy).
// Hairline left border, no cards, no elevation.
// Uses only theme/roles.ts. Touch target >= 44dp.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { DoingRecord, PlanItem } from '../../fixtures/davos';
import { PlanItemRow } from './PlanItemRow';
import { DoingLine } from './DoingLine';

export interface TodayPanelProps {
  items: PlanItem[];
  doings?: DoingRecord[];
  nextCheckIn?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onAddItem?: () => void;
  state?: 'populated' | 'empty' | 'loading' | 'error';
  errorMessage?: string;
  colorScheme?: 'light' | 'dark';
}

export function TodayPanel({
  items,
  doings = [],
  nextCheckIn = '15:00',
  isCollapsed = false,
  onToggleCollapse,
  onAddItem,
  state,
  errorMessage,
  colorScheme = 'light',
}: TodayPanelProps) {
  const colors = colorRoles[colorScheme];

  // Resolve active view state
  const effectiveState: 'populated' | 'empty' | 'loading' | 'error' =
    state ?? (items.length === 0 ? 'empty' : 'populated');

  // State: collapsed (narrow docked strip flush to the edge)
  if (isCollapsed) {
    return (
      <View
        style={[
          styles.collapsedContainer,
          {
            borderLeftColor: colors.divider,
            backgroundColor: colors.surface,
          },
        ]}>
        {onToggleCollapse && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Expand Today panel"
            hitSlop={touchTarget.hitSlop}
            style={styles.toggleButton}
            onPress={onToggleCollapse}>
            <Text
              style={[styles.toggleText, typeRoles.figure, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              {'<<'}
            </Text>
          </Pressable>
        )}
        <View style={styles.verticalTitleWrapper}>
          <Text
            style={[styles.collapsedTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Today
          </Text>
        </View>
      </View>
    );
  }

  // State: selected (expanded docked panel)
  return (
    <View
      style={[
        styles.expandedContainer,
        {
          borderLeftColor: colors.divider,
          backgroundColor: colors.surface,
        },
      ]}>
      {/* Panel header: Title and Collapse button */}
      <View style={[styles.headerRow, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.panelTitle, typeRoles.heading, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          Today
        </Text>
        {onToggleCollapse && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Collapse Today panel"
            hitSlop={touchTarget.hitSlop}
            style={styles.toggleButton}
            onPress={onToggleCollapse}>
            <Text
              style={[styles.toggleText, typeRoles.figure, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              {'>>'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Docked top line: Next check-in line (PRD §8 S2) */}
      <View style={[styles.nextCheckInRow, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.nextCheckInText, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Next check-in: {nextCheckIn}
        </Text>
      </View>

      {/* Error state: PRD copy: "Can't refresh. Showing data from 14:05." */}
      {effectiveState === 'error' && (
        <View style={[styles.statusNotice, { borderBottomColor: colors.divider }]}>
          <Text
            style={[styles.errorText, typeRoles.meta, { color: colors.danger }]}
            allowFontScaling={true}>
            {errorMessage ?? "Can't refresh. Showing data from 14:05."}
          </Text>
        </View>
      )}

      {/* Loading state: PRD copy: "Updating" */}
      {effectiveState === 'loading' && (
        <View style={[styles.statusNotice, { borderBottomColor: colors.divider }]}>
          <Text
            style={[styles.loadingText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Updating
          </Text>
        </View>
      )}

      {/* Empty state: PRD copy: "No plan for today. Set one now." + [Add first item] */}
      {effectiveState === 'empty' && (
        <View style={styles.emptyContainer}>
          <Text
            style={[styles.emptyCopy, typeRoles.davosVoice, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            No plan for today. Set one now.
          </Text>
          {onAddItem && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add first item"
              hitSlop={touchTarget.hitSlop}
              style={[styles.addItemButton, { borderColor: colors.accent }]}
              onPress={onAddItem}>
              <Text
                style={[styles.addItemText, typeRoles.meta, { color: colors.accent }]}
                allowFontScaling={true}>
                Add first item
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Populated state: Plan with Doings (PRD §12 table) */}
      {effectiveState === 'populated' && (
        <View style={styles.contentBody}>
          {items.map((planItem) => {
            const linkedDoings = doings.filter(
              (d) => d.planLink === planItem.id || (!d.planLink && doings.indexOf(d) === items.indexOf(planItem))
            );

            return (
              <View
                key={planItem.id}
                style={[styles.itemGroup, { borderBottomColor: colors.divider }]}>
                {/* PlanItemRow (time at left) */}
                <PlanItemRow
                  item={planItem}
                  colorScheme={colorScheme}
                />

                {/* Doings logged under each (PRD §3, §8 S2: time at right) */}
                {linkedDoings.map((doing) => (
                  <View key={doing.id} style={styles.doingIndent}>
                    <DoingLine
                      doing={doing}
                      colorScheme={colorScheme}
                    />
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  collapsedContainer: {
    width: 48,
    borderLeftWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  expandedContainer: {
    width: 320,
    borderLeftWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
  },
  panelTitle: {
    fontSize: 16,
  },
  toggleButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 16,
  },
  verticalTitleWrapper: {
    marginTop: spacing.md,
  },
  collapsedTitle: {
    fontSize: 13,
  },
  nextCheckInRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nextCheckInText: {
    fontSize: 13,
  },
  statusNotice: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  loadingText: {
    fontSize: 13,
  },
  errorText: {
    fontSize: 13,
  },
  emptyContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  emptyCopy: {
    fontSize: 15,
    lineHeight: 22,
  },
  addItemButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  addItemText: {
    fontSize: 14,
    fontWeight: '600',
  },
  contentBody: {
    flexDirection: 'column',
  },
  itemGroup: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.xxs,
  },
  doingIndent: {
    paddingLeft: spacing.sm,
  },
});
