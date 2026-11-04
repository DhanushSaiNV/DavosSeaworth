// components/davos/TodayPanel.tsx
// Canonical component for Object: Shell wide docked panel (Blueprint §3, §4.3).
// Executive agenda on a spine. Ordered chronologically. Interleaves plan, unplanned, urges, now-line.
// RN primitives only (FlatList, View, Text, Pressable). No cards, no elevation.

import React, { useEffect, useRef } from 'react';
import {
  FlatList,
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
import {
  GUTTER,
  RAIL,
  PANEL_PAD,
  GLYPH_PANEL,
} from '../../theme/layout';
import {
  buildDaySnapshot,
  toTimeline,
  formatTime24,
  formatDateLabel,
  type DaySnapshot,
  type TimelineRow,
  type PlanItemLike,
  type DoingRecordLike,
} from '../../domain/daySnapshot';
import { FIXTURE_NOW } from '../../domain/DayContext';
import { StatusGlyph } from '../StatusGlyph';
import { Icon } from '../ui/Icon';
import {
  sampleTodayPlanItems,
  sampleTodayDoings,
} from '../../fixtures/davos';

export const TODAY_PANEL_WIDTH = 360;

export interface TodayPanelProps {
  snapshot?: DaySnapshot;
  onSelectBeat?: (beatId: string) => void;
  onCollapse?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onAddItem?: () => void;
  fullWidth?: boolean;
  hideHeader?: boolean;
  state?: 'populated' | 'empty' | 'loading' | 'error';
  errorMessage?: string;
  colorScheme?: 'light' | 'dark';
  // Backwards compatibility props
  items?: PlanItemLike[];
  doings?: DoingRecordLike[];
  nextCheckIn?: string;
  dueNow?: string | boolean;
  isPending?: boolean;
  checkinStatus?: any;
}

export function TodayPanel({
  snapshot: propSnapshot,
  onSelectBeat,
  onCollapse,
  isCollapsed = false,
  onToggleCollapse,
  onAddItem,
  fullWidth = false,
  hideHeader = false,
  state,
  errorMessage,
  colorScheme,
  items,
  doings,
}: TodayPanelProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const isDark = colorScheme ? colorScheme === 'dark' : theme.isDark;
  const canvasBg = isDark ? colors.background : colors.surface;

  // Resolve snapshot
  const snapshot: DaySnapshot =
    propSnapshot ??
    buildDaySnapshot(
      items ?? sampleTodayPlanItems,
      doings ?? sampleTodayDoings,
      [],
      FIXTURE_NOW
    );

  const timelineRows = toTimeline(snapshot);

  // FlatList ref for scroll-to-now
  const flatListRef = useRef<FlatList<TimelineRow> | null>(null);

  // Scroll to now-row after initial layout (Blueprint §3.1)
  useEffect(() => {
    if (isCollapsed || typeof jest !== 'undefined') return;
    const nowIdx = timelineRows.findIndex((r) => r.kind === 'now');
    if (nowIdx >= 0 && flatListRef.current) {
      const timer = setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({
            index: nowIdx,
            animated: true,
            viewPosition: 0.5,
          });
        } catch {}
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isCollapsed, timelineRows.length]);

  const handleScrollToIndexFailed = (info: {
    index: number;
    highestMeasuredFrameIndex: number;
    averageItemLength: number;
  }) => {
    flatListRef.current?.scrollToOffset({
      offset: info.index * info.averageItemLength,
      animated: true,
    });
  };

  const handleToggle = onToggleCollapse ?? onCollapse;

  // Web: Esc closes/collapses panel (PRD AU19)
  useEffect(() => {
    if (isCollapsed || !handleToggle) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') handleToggle();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isCollapsed, handleToggle]);

  // Collapsed state
  if (isCollapsed) {
    return (
      <View
        style={[
          styles.collapsedContainer,
          {
            borderLeftColor: colors.divider,
            backgroundColor: canvasBg,
          },
        ]}>
        {handleToggle && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Expand Today panel"
            hitSlop={touchTarget.hitSlop}
            style={styles.collapsedButton}
            onPress={handleToggle}>
            <Icon name="calendar" size="sm" color={colors.textSecondary} />
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

  // Resolve active view state
  const effectiveState = state ?? (snapshot.beats.length === 0 ? 'empty' : 'populated');

  // Header meta: "Tue 3 Nov · 3 of 4 answered"
  const dateMeta = `${formatDateLabel(snapshot.now)} · ${snapshot.answered} of ${snapshot.dueSoFar} answered`;

  const renderTimelineRow = ({ item: row, index }: { item: TimelineRow; index: number }) => {
    const isFirst = index === 0;
    const isLast = index === timelineRows.length - 1;

    // Row = gap spacer + 44pt Pressable. Spacer = min(48, round4(minutesSincePrev*0.4)).
    const prevRow = index > 0 ? timelineRows[index - 1] : null;
    const minutesSincePrev = prevRow ? Math.max(0, Math.round((row.at - prevRow.at) / 60000)) : 0;
    const spacer = prevRow
      ? Math.min(48, Math.max(0, Math.round((minutesSincePrev * 0.4) / 4) * 4))
      : 0;

    // The spine is a 1px segment per row, position:absolute, top:0, bottom:0
    // (spanning the spacer), at x=76. First row starts at its glyph center, last
    // row ends at its glyph center. Elapsed = textTertiary, future = divider.
    const spineColor = row.at <= snapshot.now ? colors.textTertiary : colors.divider;
    const spineTop = isFirst ? spacer + 22 : 0;
    const spineBottom = isLast ? 22 : 0;

    const spineSegment = (
      <View
        style={[
          styles.spineSegment,
          {
            backgroundColor: spineColor,
            top: spineTop,
            bottom: spineBottom,
          },
        ]}
      />
    );

    // NOW-LINE
    if (row.kind === 'now') {
      return (
        <View style={styles.rowWrapper}>
          {spacer > 0 && <View style={{ height: spacer }} />}
          {spineSegment}
          <View style={styles.pressableRow}>
            {/* Time gutter: figure, textPrimary */}
            <View style={styles.gutter}>
              <Text
                style={[
                  styles.timeText,
                  typeRoles.figure,
                  { color: colors.textPrimary, fontWeight: '500' },
                ]}
                allowFontScaling={true}>
                {formatTime24(row.at)}
              </Text>
            </View>

            {/* Rail: 6px solid dot on spine centered at x=76 */}
            <View style={styles.rail}>
              <View
                style={[
                  styles.nowDot,
                  { backgroundColor: colors.textPrimary },
                ]}
              />
            </View>

            {/* Content: 1px textSecondary rule across content column only (x88–344). Never full-bleed. */}
            <View style={styles.nowRuleWrapper}>
              <View style={[styles.nowRule, { backgroundColor: colors.textSecondary }]} />
            </View>
          </View>
        </View>
      );
    }

    // UNPLANNED DOING OR URGE
    if (row.kind === 'unplanned' && row.entry) {
      const entry = row.entry;
      const isUrge = entry.kind === 'urge';

      return (
        <View style={styles.rowWrapper}>
          {spacer > 0 && <View style={{ height: spacer }} />}
          {spineSegment}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${entry.title} at ${formatTime24(row.at)}`}
            hitSlop={touchTarget.hitSlop}
            style={styles.pressableRow}
            onPress={() => onSelectBeat?.(entry.id)}>
            {/* Gutter: time in figure textTertiary */}
            <View style={styles.gutter}>
              <Text
                style={[styles.timeText, typeRoles.figure, { color: colors.textTertiary }]}
                allowFontScaling={true}>
                {formatTime24(row.at)}
              </Text>
            </View>

            {/* Rail: glyph with opaque panel background drawn above spine */}
            <View style={styles.rail}>
              {isUrge ? (
                <StatusGlyph
                  state={entry.urgeOutcome === 'yielded' ? 'urge_yielded' : 'urge_held'}
                  size={GLYPH_PANEL}
                  colorScheme={colorScheme}
                  backgroundColor={canvasBg}
                />
              ) : (
                <StatusGlyph
                  state="unplanned"
                  size={GLYPH_PANEL}
                  colorScheme={colorScheme}
                  backgroundColor={canvasBg}
                />
              )}
            </View>

            {/* Content: unplanned and urge meta textSecondary */}
            <View style={styles.content}>
              <Text
                style={[styles.unplannedText, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                {entry.title}
              </Text>
            </View>
          </Pressable>
        </View>
      );
    }

    // PLAN ITEM
    if (row.kind === 'plan' && row.beat) {
      const beat = row.beat;
      const isDone = beat.state === 'done';
      const isDue = beat.state === 'due';
      const isMissed = beat.state === 'missed';
      const isPartly = beat.state === 'partly';

      // Tone per brief:
      // due title textPrimary 500; missed/partly textPrimary 400 + annotation textSecondary;
      // done and upcoming textSecondary 400; unplanned and urge meta textSecondary.
      const titleColor = isDue || isMissed || isPartly ? colors.textPrimary : colors.textSecondary;
      const titleWeight = isDue ? '500' : '400';

      // Annotation text under title
      let actualText: string | null = null;
      if (isMissed && beat.lateByMin && beat.note) {
        actualText = `Late, answered ${formatTime24(beat.answeredAt ?? row.at)}. ${beat.note}`;
      } else if (isMissed && !beat.answeredAt) {
        actualText = 'Missed';
      } else if (isPartly && beat.note) {
        actualText = beat.note;
      }

      return (
        <View style={styles.rowWrapper}>
          {spacer > 0 && <View style={{ height: spacer }} />}
          {spineSegment}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Plan item ${beat.planItem.order}: ${beat.planItem.text} at ${beat.planItem.time}, status ${beat.state}`}
            hitSlop={touchTarget.hitSlop}
            style={styles.pressableRow}
            onPress={() => onSelectBeat?.(beat.planItem.id)}>
            {/* Gutter: time in figure */}
            <View style={styles.gutter}>
              <Text
                style={[
                  styles.timeText,
                  typeRoles.figure,
                  { color: isDue ? colors.textPrimary : colors.textSecondary },
                ]}
                allowFontScaling={true}>
                {formatTime24(row.at)}
              </Text>
            </View>

            {/* Rail: 16px StatusGlyph with opaque background above spine */}
            <View style={styles.rail}>
              <StatusGlyph
                state={beat.state}
                size={GLYPH_PANEL}
                colorScheme={colorScheme}
                backgroundColor={canvasBg}
              />
            </View>

            {/* Content: Title & optional Annotation */}
            <View style={styles.content}>
              <Text
                style={[
                  styles.planTitle,
                  typeRoles.userText,
                  { color: titleColor, fontWeight: titleWeight },
                ]}
                allowFontScaling={true}>
                {beat.planItem.text}
              </Text>

              {actualText ? (
                <Text
                  style={[
                    styles.actualText,
                    typeRoles.meta,
                    { color: colors.textSecondary },
                  ]}
                  allowFontScaling={true}>
                  {actualText}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </View>
      );
    }

    return null;
  };

  return (
    <View
      style={[
        fullWidth ? styles.fullWidthContainer : styles.expandedContainer,
        {
          borderLeftColor: colors.divider,
          backgroundColor: canvasBg,
        },
      ]}>
      {/* 1. Panel header: Title and Collapse button (Blueprint §3.2) */}
      {!hideHeader && (
        <View style={[styles.headerRow, { borderBottomColor: colors.divider }]}>
          <View style={styles.headerTitleGroup}>
            <Text
              style={[styles.panelTitle, typeRoles.heading, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Today
            </Text>
            <Text
              style={[styles.headerMeta, typeRoles.meta, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              {dateMeta}
            </Text>
          </View>

          {handleToggle && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Collapse Today panel"
              hitSlop={touchTarget.hitSlop}
              style={styles.toggleButton}
              onPress={handleToggle}>
              <Icon name="chevrons-right" size="sm" color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {/* 2. Error state: "Can't refresh. Showing data from 14:05." */}
      {effectiveState === 'error' && (
        <View style={[styles.statusNotice, { borderBottomColor: colors.divider }]}>
          <Text
            style={[styles.errorText, typeRoles.meta, { color: colors.danger }]}
            allowFontScaling={true}>
            {errorMessage ?? "Can't refresh. Showing data from 14:05."}
          </Text>
        </View>
      )}

      {/* 3. Loading state: "Updating" */}
      {effectiveState === 'loading' && (
        <View style={[styles.statusNotice, { borderBottomColor: colors.divider }]}>
          <Text
            style={[styles.loadingText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Updating
          </Text>
        </View>
      )}

      {/* 4. Empty state: "No plan for today. Set one now." + [Add first item] */}
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
                style={[
                  styles.addItemText,
                  typeRoles.davosVoice,
                  { color: colors.textPrimary, fontWeight: '500' },
                ]}
                allowFontScaling={true}>
                Add first item
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* 5. Populated state: FlatList timeline */}
      {effectiveState === 'populated' && (
        <FlatList
          ref={flatListRef}
          data={timelineRows}
          keyExtractor={(item) => item.key}
          renderItem={renderTimelineRow}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          contentContainerStyle={styles.timelineContent}
          showsVerticalScrollIndicator={false}
          style={styles.flatList}
        />
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
    width: TODAY_PANEL_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    flex: 1,
  },
  fullWidthContainer: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    flexDirection: 'column',
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  headerTitleGroup: {
    flexDirection: 'column',
    gap: spacing.xxs,
  },
  panelTitle: {
    paddingHorizontal: spacing.none,
  },
  headerMeta: {
    paddingHorizontal: spacing.none,
  },
  toggleButton: {
    width: 44,
    height: 44,
    minHeight: 44,
    minWidth: 44,
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
  flatList: {
    flex: 1,
    width: '100%',
  },
  timelineContent: {
    paddingHorizontal: 0,
    paddingVertical: spacing.sm,
  },
  rowWrapper: {
    width: '100%',
    position: 'relative',
  },
  spineSegment: {
    position: 'absolute',
    left: 75.5,
    width: 1,
    zIndex: 1,
  },
  pressableRow: {
    minHeight: 44,
    height: 44,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: PANEL_PAD,
    paddingRight: PANEL_PAD,
    zIndex: 2,
  },
  gutter: {
    width: GUTTER,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  timeText: {
    paddingHorizontal: spacing.none,
  },
  rail: {
    width: RAIL,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  nowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    zIndex: 2,
  },
  nowRuleWrapper: {
    width: 256,
    flex: 1,
    paddingLeft: 0,
    justifyContent: 'center',
  },
  nowRule: {
    height: 1,
    width: '100%',
  },
  content: {
    width: 256,
    flex: 1,
    paddingLeft: 0,
    justifyContent: 'center',
  },
  planTitle: {
    paddingHorizontal: spacing.none,
  },
  actualText: {
    paddingTop: 2,
    paddingHorizontal: spacing.none,
  },
  unplannedText: {
    paddingHorizontal: spacing.none,
  },
});
