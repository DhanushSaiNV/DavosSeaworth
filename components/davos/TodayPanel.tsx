// components/davos/TodayPanel.tsx
// Canonical component for Object: Shell wide docked panel (PRD §0, §6, §8, §12; design/DESIGN.md §6).
// Width >= 1200dp: Docked Today panel flush to the edge (~ nice-to-have per PRD §6).
// Props: items
// States: selected (expanded), collapsed
// Four view states: empty, loading, populated, error (PRD §12 copy).
// Hairline left border, no cards, no elevation.
// Uses theme hook (PRD Step 0, A.2, AU37). Touch target >= 44dp.

import React, { useEffect } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { DoingRecord, PlanItem, groupDoingsByPlan, initialStatusLine, computeCheckinStatus, type CheckinCountsResult } from '../../fixtures/davos';
import { format24Hour } from '../../lib/timeFormat';
import { DoingLine } from './DoingLine';
import { StatusMark } from './StatusMark';
import { Icon } from '../ui/Icon';
import { SampleDataMarker } from './SampleDataMarker';

export interface TodayPanelProps {
  items: PlanItem[];
  doings?: DoingRecord[];
  nextCheckIn?: string;
  dueNow?: string | boolean;
  isPending?: boolean;
  checkinStatus?: CheckinCountsResult;
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
  nextCheckIn = initialStatusLine.nextCheckIn,
  dueNow,
  isPending = false,
  checkinStatus,
  isCollapsed = false,
  onToggleCollapse,
  onAddItem,
  state,
  errorMessage,
  colorScheme,
}: TodayPanelProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  // Resolve active view state
  const effectiveState: 'populated' | 'empty' | 'loading' | 'error' =
    state ?? (items.length === 0 ? 'empty' : 'populated');

  // Shared next or due check-in resolution via single canonical computeCheckinStatus function (PRD C.2, AU41)
  const resolvedStatus =
    checkinStatus ??
    computeCheckinStatus(items, {
      dueInterval: typeof dueNow === 'string' ? dueNow : dueNow || isPending ? '18:00' : null,
      isPending: Boolean(isPending || dueNow),
      nextCheckInTime: nextCheckIn,
    });
  const timeLabel = resolvedStatus.nextOrDue.label;
  const displayTime = resolvedStatus.nextOrDue.time;

  // Web: Esc closes/collapses panel (PRD AU19, Behaviour Pass)
  useEffect(() => {
    if (isCollapsed || !onToggleCollapse) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onToggleCollapse();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isCollapsed, onToggleCollapse]);

  // State: collapsed (narrow docked strip flush to the edge with icon and label >= 12px per PRD A.5)
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
            style={styles.collapsedButton}
            onPress={onToggleCollapse}>
            <Icon
              name="calendar"
              size="sm"
              color={colors.textSecondary}
            />
            <Text
              style={[styles.collapsedTitle, typeRoles.meta, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              Today
            </Text>
          </Pressable>
        )}
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
            <Icon
              name="chevrons-right"
              size="sm"
              color={colors.textSecondary}
            />
          </Pressable>
        )}
      </View>

      {/* Docked top line: Next / Due check-in line (PRD §8 S2, C.2) */}
      <View style={[styles.nextCheckInRow, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.nextCheckInText, typeRoles.meta, { color: colors.textSecondary, fontWeight: '400' }]}
          allowFontScaling={true}>
          {timeLabel}{' '}
          <Text style={[typeRoles.figure, { color: colors.textSecondary, fontWeight: '400' }]}>
            {displayTime ? format24Hour(displayTime) : ''}
          </Text>
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
              style={[styles.addItemButton, { borderColor: colors.divider }]}
              onPress={onAddItem}>
              <Text
                style={[styles.addItemText, typeRoles.meta, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                Add first item
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Populated state: Plan with Doings (PRD §12 table) */}
      {effectiveState === 'populated' && (() => {
        const { planGroups, unlinkedDoings } = groupDoingsByPlan(items, doings);
        return (
          <View style={styles.contentBody}>
            {planGroups.map(({ planItem, doings: linkedDoings }) => (
              <View
                key={planItem.id}
                style={[styles.itemGroup, { borderBottomColor: colors.divider }]}>
                {/* Unsqueezed plan item row: time & status on top row, full title below (F.1) */}
                <View
                  style={styles.panelPlanItemRow}
                  accessible={true}
                  accessibilityRole="text"
                  accessibilityLabel={`Plan item ${planItem.order}: ${planItem.text} at ${planItem.time}, status ${planItem.status}`}>
                  <View style={styles.panelPlanItemTop}>
                    <Text
                      style={[styles.timeText, typeRoles.figure, { color: colors.textSecondary }]}
                      allowFontScaling={true}>
                      {planItem.time ? format24Hour(planItem.time) : ''}
                    </Text>
                    <StatusMark
                      status={planItem.status}
                      showLabel={true}
                    />
                  </View>
                  <Text
                    style={[styles.panelTitleText, typeRoles.davosVoice, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    {planItem.text}
                  </Text>
                </View>

                {/* Doings logged under each (PRD §3, §8 S2: time at right) */}
                {linkedDoings.map((doing) => (
                  <View key={doing.id} style={styles.doingIndent}>
                    <DoingLine doing={doing} />
                  </View>
                ))}
              </View>
            ))}

            {/* Also logged section for unlinked items (e.g. urge) per PRD C.4 */}
            {unlinkedDoings.length > 0 && (
              <View style={[styles.itemGroup, { borderBottomColor: colors.divider }]}>
                <Text
                  style={[styles.alsoLoggedTitle, typeRoles.meta, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  Also logged
                </Text>
                {unlinkedDoings.map((doing) => (
                  <View key={doing.id} style={styles.doingIndent}>
                    <DoingLine doing={doing} />
                  </View>
                ))}
              </View>
            )}

            <SampleDataMarker screen="Today Panel" />
          </View>
        );
      })()}
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
    paddingHorizontal: spacing.none,
  },
  toggleButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
  },
  collapsedButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  collapsedTitle: {
    paddingHorizontal: spacing.none,
  },
  alsoLoggedTitle: {
    paddingVertical: spacing.xxs,
  },
  nextCheckInRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nextCheckInText: {
    paddingHorizontal: spacing.none,
  },
  statusNotice: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  loadingText: {
    paddingHorizontal: spacing.none,
  },
  errorText: {
    paddingHorizontal: spacing.none,
  },
  emptyContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  emptyCopy: {
    paddingHorizontal: spacing.none,
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
    paddingHorizontal: spacing.none,
  },
  contentBody: {
    flexDirection: 'column',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  itemGroup: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.xxs,
  },
  panelPlanItemRow: {
    paddingVertical: spacing.xs,
    gap: spacing.xxs,
  },
  panelPlanItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timeText: {
    paddingHorizontal: spacing.none,
  },
  panelTitleText: {
    paddingHorizontal: spacing.none,
    width: '100%',
  },
  doingIndent: {
    paddingLeft: spacing.sm,
  },
});
