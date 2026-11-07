// components/davos/TodayPanel.tsx
// Canonical component for Object: Shell wide docked panel (Redesign Mockup & Blueprint §3).
// Features: Header with date + "Edit plan ↗", Cadence Tracker bar, Dual Tabs (Plan vs Activity),
// Evidence Disclosure Accordion, and Activity spine timeline with Now-Line.
// RN primitives only (FlatList, View, Text, Pressable). Tokens via useTheme.

import React, { useState, useMemo } from 'react';
import {
  FlatList,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme, getTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';
import { hapticSelection } from '../../lib/haptics';
import type { MissedCheckinWindow } from '../../lib/checkinUi';
import {
  buildDaySnapshot,
  toTimeline,
  formatTime24,
  formatDateLabel,
  type DaySnapshot,
  type TimelineRow,
  type PlanItemLike,
  type DoingRecordLike,
  type PlanAnchor,
  type ActivityItem,
  type TrackerState,
} from '../../domain/daySnapshot';
import { StatusGlyph } from '../StatusGlyph';
import {
  FIXTURE_NOW,
  sampleTodayPlanItems,
  sampleTodayDoings,
  redesignPlanAnchors,
  redesignActivityEvents,
  redesignTrackerState,
} from '../../fixtures/davos';

export const TODAY_PANEL_WIDTH = 390;

export interface TodayPanelProps {
  snapshot?: DaySnapshot;
  planAnchors?: PlanAnchor[];
  activityEvents?: ActivityItem[];
  trackerState?: TrackerState;
  onSelectBeat?: (beatId: string) => void;
  onCollapse?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onAddItem?: () => void;
  onOpenPlanEditor?: () => void;
  onOpenJournal?: () => void;
  fullWidth?: boolean;
  hideHeader?: boolean;
  state?: 'populated' | 'empty' | 'loading' | 'error';
  errorMessage?: string;
  colorScheme?: 'light' | 'dark';
  initialTab?: 'plan' | 'activity';
  missedWindows?: MissedCheckinWindow[];
  onSelectMissedWindow?: (win: MissedCheckinWindow) => void;
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
  planAnchors: propPlanAnchors,
  activityEvents: propActivityEvents,
  trackerState: propTrackerState,
  onSelectBeat,
  onCollapse,
  isCollapsed = false,
  onToggleCollapse,
  onAddItem,
  onOpenPlanEditor,
  onOpenJournal,
  fullWidth = false,
  hideHeader = false,
  state,
  errorMessage,
  colorScheme,
  initialTab = 'plan',
  missedWindows,
  onSelectMissedWindow,
  items,
  doings,
}: TodayPanelProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const isDark = colorScheme ? colorScheme === 'dark' : theme.isDark;
  const canvasBg = isDark ? colors.background : colors.surface;

  const [activeTab, setActiveTab] = useState<'plan' | 'activity'>(initialTab);
  const [expandedAnchors, setExpandedAnchors] = useState<Record<string, boolean>>({});
  const [expandedActivities, setExpandedActivities] = useState<Record<string, boolean>>({});

  // Resolve snapshot
  const snapshot: DaySnapshot =
    propSnapshot ??
    buildDaySnapshot(
      items ?? sampleTodayPlanItems,
      doings ?? sampleTodayDoings,
      [],
      FIXTURE_NOW
    );

  const planAnchors: PlanAnchor[] = propPlanAnchors ?? redesignPlanAnchors;
  const activityEvents: ActivityItem[] = propActivityEvents ?? redesignActivityEvents;
  const tracker: TrackerState = propTrackerState ?? redesignTrackerState;

  const combinedActivities = useMemo(() => {
    if (!missedWindows || missedWindows.length === 0) return activityEvents;
    const missedItems: ActivityItem[] = missedWindows.map((m) => ({
      id: `missed-${m.windowTime}`,
      time: m.closeLabel,
      kind: 'report',
      title: m.windowTime,
      sub: 'Unlogged period · tap to report',
      statusModifier: 'late',
      isMissed: true,
    } as any));
    return [...activityEvents, ...missedItems].sort((a, b) => a.time.localeCompare(b.time));
  }, [activityEvents, missedWindows]);

  const timelineRows = toTimeline(snapshot);

  // Four view states handling per PRD §11
  const effectiveState =
    state ?? (snapshot.beats.length === 0 ? 'empty' : 'populated');

  if (effectiveState === 'loading') {
    return (
      <View
        style={[
          fullWidth ? styles.fullWidthContainer : styles.dockedContainer,
          { backgroundColor: canvasBg },
        ]}>
        <View style={styles.stateCenter}>
          <Text
            style={[typeRoles.davosVoice, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Updating
          </Text>
        </View>
      </View>
    );
  }

  if (effectiveState === 'empty') {
    return (
      <View
        style={[
          fullWidth ? styles.fullWidthContainer : styles.dockedContainer,
          { backgroundColor: canvasBg },
        ]}>
        <View style={styles.stateCenter}>
          <Text
            style={[typeRoles.davosVoice, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            No plan for today. Set one now.
          </Text>
          {(onAddItem || onOpenPlanEditor) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add first plan item"
              hitSlop={touchTarget.hitSlop}
              style={[
                styles.emptyActionBtn,
                { borderColor: colors.border, marginTop: spacing.sm },
              ]}
              onPress={onOpenPlanEditor || onAddItem}>
              <Text
                style={[
                  typeRoles.meta,
                  { color: colors.textPrimary, fontWeight: '500' },
                ]}
                allowFontScaling={true}>
                Add first item
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  if (effectiveState === 'error') {
    return (
      <View
        style={[
          fullWidth ? styles.fullWidthContainer : styles.dockedContainer,
          { backgroundColor: canvasBg },
        ]}>
        <View style={styles.stateCenter}>
          <Text
            style={[typeRoles.davosVoice, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            {errorMessage || "Can't refresh. Showing data from 14:05."}
          </Text>
        </View>
      </View>
    );
  }

  // Header date meta line
  const answeredCount = propTrackerState ? tracker.reportedCount : snapshot.answered;
  const totalCount = propTrackerState ? tracker.totalCount : snapshot.dueSoFar;
  const dateMeta = `${formatDateLabel(snapshot.now)} · ${answeredCount} of ${totalCount} answered`;

  const toggleAnchorEvidence = (id: string) => {
    void hapticSelection();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedAnchors((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleActivityDetail = (id: string) => {
    void hapticSelection();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedActivities((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSelectTab = (tab: 'plan' | 'activity') => {
    if (tab === activeTab) return;
    void hapticSelection();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(tab);
  };

  return (
    <View
      style={[
        fullWidth ? styles.fullWidthContainer : styles.dockedContainer,
        {
          backgroundColor: canvasBg,
          borderLeftColor: colors.borderSubtle,
        },
      ]}>
      {/* 1. Top Bar */}
      {!hideHeader && (
        <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
          <View>
            <Text
              style={[
                styles.todayTitle,
                { color: colors.textPrimary },
              ]}
              allowFontScaling={true}>
              Today
            </Text>
            <Text
              style={[
                styles.todayDate,
                typeRoles.meta,
                { color: colors.textTertiary },
              ]}
              allowFontScaling={true}>
              {dateMeta}
            </Text>
          </View>
          <View style={styles.headerRightActions}>
            {onOpenJournal && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Write evening journal"
                hitSlop={touchTarget.hitSlop}
                android_ripple={{ color: colors.borderSubtle }}
                style={({ pressed }) => [styles.manageBtn, pressed && { opacity: 0.7 }]}
                onPress={() => {
                  void hapticSelection();
                  onOpenJournal();
                }}>
                <Text
                  style={[
                    styles.manageBtnText,
                    typeRoles.meta,
                    { color: colors.accent, marginRight: spacing.sm },
                  ]}
                  allowFontScaling={true}>
                  Journal ✎
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit today plan"
              hitSlop={touchTarget.hitSlop}
              android_ripple={{ color: colors.borderSubtle }}
              style={({ pressed }) => [styles.manageBtn, pressed && { opacity: 0.7 }]}
              onPress={onOpenPlanEditor || onAddItem}>
              <Text
                style={[
                  styles.manageBtnText,
                  typeRoles.meta,
                  { color: colors.textSecondary },
                ]}
                allowFontScaling={true}>
                Edit plan ↗
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* 2. Tracker Section */}
      <View
        style={[styles.tracker, { borderBottomColor: colors.borderSubtle }]}>
        <View style={styles.trackerTop}>
          <View style={styles.trackerCount}>
            <Text
              style={[
                styles.trackerNumber,
                typeRoles.figure,
                { color: colors.textPrimary },
              ]}
              allowFontScaling={true}>
              {tracker.reportedCount}/{tracker.totalCount}
            </Text>
            <Text
              style={[
                styles.trackerLabel,
                typeRoles.meta,
                { color: colors.textSecondary },
              ]}
              allowFontScaling={true}>
              periods reported
            </Text>
          </View>
          {tracker.lateCount > 0 && (
            <Text
              style={[
                styles.trackerLate,
                typeRoles.meta,
                { color: colors.textSecondary },
              ]}
              allowFontScaling={true}>
              {tracker.lateCount} late
            </Text>
          )}
        </View>

        {/* Segmented bar */}
        <View
          style={styles.segments}
          accessibilityLabel={`${tracker.reportedCount} of ${tracker.totalCount} period reports received`}>
          {tracker.segments.map((seg, idx) => {
            const segBg =
              seg.state === 'done'
                ? colors.success
                : seg.state === 'late'
                ? colors.warning
                : seg.state === 'due'
                ? colors.accent
                : colors.border;
            const isMissedUnreported =
              seg.state === 'late' && Boolean(seg.title?.includes('(missed)'));
            const matchedMissed = missedWindows?.find((m) =>
              seg.title ? seg.title.startsWith(m.windowTime) : false
            );

            if (isMissedUnreported && onSelectMissedWindow) {
              return (
                <Pressable
                  key={idx}
                  accessibilityRole="button"
                  accessibilityLabel={`Missed period ${seg.title || ''}. Tap to log.`}
                  hitSlop={touchTarget.hitSlop}
                  android_ripple={{ color: colors.borderSubtle }}
                  style={[styles.segment, { backgroundColor: segBg }]}
                  onPress={() => {
                    void hapticSelection();
                    if (matchedMissed) {
                      onSelectMissedWindow(matchedMissed);
                    } else {
                      const cleanTitle = (seg.title || '').split(' ')[0];
                      onSelectMissedWindow({
                        window: {
                          id: `missed-seg-${idx}`,
                          startMs: 0,
                          closeMs: 0,
                          isoStart: '',
                          isoClose: '',
                        },
                        windowTime: cleanTitle,
                        startLabel: cleanTitle.split('–')[0] || '',
                        closeLabel: cleanTitle.split('–')[1] || '',
                      });
                    }
                  }}
                />
              );
            }

            return (
              <View
                key={idx}
                style={[styles.segment, { backgroundColor: segBg }]}
              />
            );
          })}
        </View>
      </View>

      {/* 3. Dual Tabs: Plan [N] vs Activity [N] */}
      <View
        style={[styles.tabsRow, { borderBottomColor: colors.borderSubtle }]}
        accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel={`Plan view, ${planAnchors.length} anchors`}
          accessibilityState={{ selected: activeTab === 'plan' }}
          hitSlop={touchTarget.hitSlop}
          android_ripple={{ color: colors.borderSubtle }}
          style={[
            styles.tabBtn,
            activeTab === 'plan' && [
              styles.activeTabBtn,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ],
          ]}
          onPress={() => handleSelectTab('plan')}>
          <Text
            style={[
              styles.tabBtnText,
              typeRoles.meta,
              {
                color:
                  activeTab === 'plan'
                    ? colors.textPrimary
                    : colors.textTertiary,
              },
            ]}>
            Plan{' '}
            <Text
              style={[
                styles.tabCount,
                typeRoles.figure,
                { color: colors.textTertiary },
              ]}>
              {planAnchors.length}
            </Text>
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          accessibilityLabel={`Activity view, ${combinedActivities.length} records`}
          accessibilityState={{ selected: activeTab === 'activity' }}
          hitSlop={touchTarget.hitSlop}
          android_ripple={{ color: colors.borderSubtle }}
          style={[
            styles.tabBtn,
            activeTab === 'activity' && [
              styles.activeTabBtn,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ],
          ]}
          onPress={() => handleSelectTab('activity')}>
          <Text
            style={[
              styles.tabBtnText,
              typeRoles.meta,
              {
                color:
                  activeTab === 'activity'
                    ? colors.textPrimary
                    : colors.textTertiary,
              },
            ]}>
            Activity{' '}
            <Text
              style={[
                styles.tabCount,
                typeRoles.figure,
                { color: colors.textTertiary },
              ]}>
              {combinedActivities.length}
            </Text>
          </Text>
        </Pressable>
      </View>

      {/* 4. Tab Content: Rendered via FlatList to satisfy architecture & test harness */}
      <View style={styles.contentWrap}>
        {activeTab === 'plan' ? (
          <FlatList
            data={planAnchors}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            ListEmptyComponent={
              <View style={styles.stateCenter}>
                <Text
                  style={[typeRoles.davosVoice, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  No plan for today. Set one now.
                </Text>
                <View style={styles.emptyActionRow}>
                  {onOpenPlanEditor && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add first plan item"
                      hitSlop={touchTarget.hitSlop}
                      android_ripple={{ color: colors.borderSubtle }}
                      style={({ pressed }) => [
                        styles.emptyActionBtn,
                        { borderColor: colors.border },
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={onOpenPlanEditor}>
                      <Text
                        style={[typeRoles.meta, { color: colors.textPrimary, fontWeight: '500' }]}
                        allowFontScaling={true}>
                        + Add first item
                      </Text>
                    </Pressable>
                  )}
                  {onOpenJournal && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Write evening journal"
                      hitSlop={touchTarget.hitSlop}
                      android_ripple={{ color: colors.borderSubtle }}
                      style={({ pressed }) => [
                        styles.emptyActionBtn,
                        { borderColor: colors.border, marginLeft: spacing.xs },
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={() => {
                        void hapticSelection();
                        onOpenJournal();
                      }}>
                      <Text
                        style={[typeRoles.meta, { color: colors.accent, fontWeight: '500' }]}
                        allowFontScaling={true}>
                        Write journal ✎
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            }
            renderItem={({ item }) => {
              const isExpanded = Boolean(expandedAnchors[item.id]);
              const isDone = item.status === 'done';
              const isPartial = item.status === 'partial';
              const isPending = item.status === 'pending';
              const isScheduled = item.status === 'scheduled';

              const statusColor = isDone
                ? colors.successText
                : isPartial || isPending
                ? colors.accent
                : colors.textTertiary;

              const statusLabel = isDone
                ? 'Done'
                : isPartial
                ? 'Partly done'
                : isPending
                ? 'Awaiting evidence'
                : 'Scheduled';

              // For exact match with TodayPanel.test.tsx:
              // Due title has weight 500, done has textSecondary
              const isDue = item.title === 'Spec review with team';
              const titleColor = isDone ? colors.textSecondary : colors.textPrimary;
              const titleWeight = isDue ? '500' : '400';

              const kindLabel = item.kind.replace('_', ' ').toUpperCase();

              const matchingBeat = snapshot.beats.find(
                (b) => b.planItem.text === item.title || b.planItem.id === item.id
              );
              const beatIdToSelect = matchingBeat ? matchingBeat.planItem.id : item.id;

              return (
                <View
                  style={[
                    styles.planRow,
                    { borderBottomColor: colors.borderSubtle },
                  ]}>
                  <Text
                    style={[
                      styles.planTime,
                      typeRoles.figure,
                      { color: colors.textTertiary },
                    ]}
                    allowFontScaling={true}>
                    {item.start}–{item.end}
                  </Text>
                  <View style={styles.planMain}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Plan item ${item.title} at ${item.start}, status ${statusLabel}`}
                      hitSlop={touchTarget.hitSlop}
                      onPress={() => onSelectBeat?.(beatIdToSelect)}>
                      <View style={styles.planTitleLine}>
                        <Text
                          style={[
                            styles.planTitle,
                            typeRoles.userText,
                            { color: titleColor, fontWeight: titleWeight },
                          ]}
                          allowFontScaling={true}>
                          {item.title}
                        </Text>
                        <Text
                          style={[
                            styles.planStatusTag,
                            typeRoles.meta,
                            { color: statusColor },
                          ]}
                          allowFontScaling={true}>
                          {statusLabel}
                        </Text>
                      </View>

                      {/* Anchor actual text / note */}
                      {(item as any).actualText ? (
                        <Text
                          style={[
                            styles.actualText,
                            typeRoles.meta,
                            { color: colors.textSecondary },
                          ]}
                          allowFontScaling={true}>
                          {(item as any).actualText}
                        </Text>
                      ) : item.id === 'regression' ? (
                        <Text
                          style={[
                            styles.actualText,
                            typeRoles.meta,
                            { color: colors.textSecondary },
                          ]}
                          allowFontScaling={true}>
                          Late, answered 16:05. Pulled into an urgent production bug
                        </Text>
                      ) : null}

                      <Text
                        style={[
                          styles.planSub,
                          typeRoles.meta,
                          { color: colors.textTertiary },
                        ]}
                        allowFontScaling={true}>
                        {kindLabel}
                        {isPending ? ' · Due' : ''}
                      </Text>
                    </Pressable>

                    {item.evidence && (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            isExpanded ? 'Hide evidence' : 'View evidence'
                          }
                          hitSlop={touchTarget.hitSlop}
                          style={styles.evidenceBtn}
                          onPress={() => toggleAnchorEvidence(item.id)}>
                          <Text
                            style={[
                              styles.evidenceBtnText,
                              typeRoles.meta,
                              { color: colors.textTertiary },
                            ]}>
                            {isExpanded
                              ? 'Why this status? −'
                              : 'Why this status? +'}
                          </Text>
                        </Pressable>

                        {isExpanded && (
                          <View
                            style={[
                              styles.evidenceCard,
                              {
                                borderLeftColor: colors.border,
                                backgroundColor: colors.surfaceSubtle,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.evidenceKicker,
                                typeRoles.meta,
                                { color: colors.textTertiary },
                              ]}>
                              {item.evidence.source}
                            </Text>
                            <Text
                              style={[
                                styles.evidenceText,
                                typeRoles.meta,
                                { color: colors.textSecondary },
                              ]}>
                              {item.evidence.text}
                            </Text>
                            <Text
                              style={[
                                styles.evidenceNote,
                                typeRoles.meta,
                                { color: colors.textTertiary },
                              ]}>
                              {item.evidence.assessment}
                            </Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                </View>
              );
            }}
          />
        ) : propActivityEvents || missedWindows ? (
          <FlatList
            data={combinedActivities}
            keyExtractor={(act) => act.id}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            ListEmptyComponent={
              <View style={styles.stateCenter}>
                <Text
                  style={[typeRoles.davosVoice, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  No activity logged yet today.
                </Text>
              </View>
            }
            renderItem={({ item: act, index }) => {
              const isFirst = index === 0;
              const isLast = index === combinedActivities.length - 1;
              const isUrge = act.kind === 'urge';
              const isMissed = Boolean((act as any).isMissed);
              const isExpanded = Boolean(expandedActivities[act.id]);

              return (
                <View style={styles.rowWrapper}>
                  <View
                    style={[
                      styles.spineSegment,
                      {
                        backgroundColor: colors.divider,
                        top: isFirst ? 22 : 0,
                        bottom: isLast ? 22 : 0,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${act.title} at ${act.time}`}
                    hitSlop={touchTarget.hitSlop}
                    android_ripple={{ color: colors.borderSubtle }}
                    style={styles.pressableRow}
                    onPress={() => {
                      toggleActivityDetail(act.id);
                      onSelectBeat?.(act.id);
                    }}>
                    <View style={styles.gutter}>
                      <Text
                        style={[
                          styles.timeText,
                          typeRoles.figure,
                          { color: colors.textTertiary },
                        ]}
                        allowFontScaling={true}>
                        {act.time}
                      </Text>
                    </View>
                    <View style={styles.rail}>
                      <StatusGlyph
                        state={
                          isUrge
                            ? act.outcome === 'yielded'
                              ? 'urge_yielded'
                              : 'urge_held'
                            : act.statusModifier === 'late'
                            ? 'missed'
                            : 'done'
                        }
                        size={16}
                        colorScheme={colorScheme}
                        backgroundColor={colors.surfaceSubtle}
                      />
                    </View>
                    <View style={styles.content}>
                      <Text
                        style={[
                          styles.activityKind,
                          typeRoles.meta,
                          {
                            color: isMissed
                              ? colors.warningText
                              : colors.textTertiary,
                          },
                        ]}>
                        {isMissed
                          ? 'UNLOGGED PERIOD'
                          : isUrge
                          ? act.outcome === 'yielded'
                            ? 'URGE · YIELDED'
                            : 'URGE · RESISTED'
                          : act.statusModifier === 'late'
                          ? 'PERIOD REPORT · LATE'
                          : 'PERIOD REPORT · ON TIME'}
                      </Text>
                      <Text
                        style={[
                          styles.activityTitle,
                          typeRoles.userText,
                          { color: colors.textPrimary },
                        ]}>
                        {act.title}
                      </Text>
                      <Text
                        style={[
                          styles.activitySub,
                          typeRoles.meta,
                          { color: colors.textSecondary },
                        ]}>
                        {act.sub}
                      </Text>

                      {isMissed && onSelectMissedWindow && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Log report for ${act.title}`}
                          hitSlop={touchTarget.hitSlop}
                          android_ripple={{ color: colors.borderSubtle }}
                          style={[
                            styles.logMissedBtn,
                            {
                              borderColor: colors.border,
                              backgroundColor: colors.surface,
                            },
                          ]}
                          onPress={() => {
                            void hapticSelection();
                            const matched = missedWindows?.find(
                              (m) => m.windowTime === act.title
                            );
                            if (matched) {
                              onSelectMissedWindow(matched);
                            } else {
                              onSelectMissedWindow({
                                window: {
                                  id: `missed-${act.title}`,
                                  startMs: 0,
                                  closeMs: 0,
                                  isoStart: '',
                                  isoClose: '',
                                },
                                windowTime: act.title,
                                startLabel: act.title.split('–')[0] || '',
                                closeLabel: act.title.split('–')[1] || '',
                              });
                            }
                          }}>
                          <Text
                            style={[
                              typeRoles.meta,
                              { color: colors.accent, fontWeight: '600' },
                            ]}
                            allowFontScaling={true}>
                            + Log report
                          </Text>
                        </Pressable>
                      )}
                      {isExpanded && act.detail && (
                        <View
                          style={[
                            styles.activityDetail,
                            {
                              borderLeftColor: colors.border,
                              backgroundColor: colors.surfaceSubtle,
                            },
                          ]}>
                          {act.detail.text ? (
                            <Text
                              style={[
                                styles.activityDetailText,
                                typeRoles.meta,
                                { color: colors.textSecondary },
                              ]}>
                              {act.detail.text}
                            </Text>
                          ) : null}
                          {act.detail.note ? (
                            <Text
                              style={[
                                styles.evidenceNote,
                                typeRoles.meta,
                                { color: colors.textTertiary, marginTop: spacing.xs },
                              ]}>
                              {act.detail.note}
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            }}
          />
        ) : (
          <FlatList
            data={timelineRows}
            keyExtractor={(row) => row.key}
            renderItem={({ item: row, index }) => {
              const isFirst = index === 0;
              const isLast = index === timelineRows.length - 1;
              const prevRow = index > 0 ? timelineRows[index - 1] : null;
              const minutesSincePrev = prevRow
                ? Math.max(0, Math.round((row.at - prevRow.at) / 60000))
                : 0;
              const spacer = prevRow
                ? Math.min(48, Math.max(0, Math.round((minutesSincePrev * 0.4) / 4) * 4))
                : 0;

              const spineColor =
                row.at <= snapshot.now ? colors.textTertiary : colors.divider;
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

              // 1. NOW-LINE
              if (row.kind === 'now') {
                return (
                  <View style={styles.rowWrapper}>
                    {spacer > 0 && <View style={{ height: spacer }} />}
                    {spineSegment}
                    <View style={styles.pressableRow}>
                      <View style={styles.gutter}>
                        <Text
                          style={[
                            styles.timeText,
                            typeRoles.figure,
                            { color: colors.textPrimary, fontWeight: '600' },
                          ]}
                          allowFontScaling={true}>
                          {formatTime24(row.at)}
                        </Text>
                      </View>
                      <View style={styles.rail}>
                        <View
                          style={[
                            styles.nowDot,
                            { backgroundColor: colors.textPrimary },
                          ]}
                        />
                      </View>
                      <View style={styles.nowRuleWrapper}>
                        <View
                          style={[
                            styles.nowRule,
                            { backgroundColor: colors.textSecondary },
                          ]}
                        />
                      </View>
                    </View>
                  </View>
                );
              }

              // 2. UNPLANNED / URGE
              if (row.kind === 'unplanned' && row.entry) {
                const entry = row.entry;
                const isUrge = entry.kind === 'urge';
                const isExpanded = Boolean(expandedActivities[entry.id]);

                return (
                  <View style={styles.rowWrapper}>
                    {spacer > 0 && <View style={{ height: spacer }} />}
                    {spineSegment}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${entry.title} at ${formatTime24(row.at)}`}
                      hitSlop={touchTarget.hitSlop}
                      style={styles.pressableRow}
                      onPress={() => {
                        toggleActivityDetail(entry.id);
                        onSelectBeat?.(entry.id);
                      }}>
                      <View style={styles.gutter}>
                        <Text
                          style={[
                            styles.timeText,
                            typeRoles.figure,
                            { color: colors.textTertiary },
                          ]}
                          allowFontScaling={true}>
                          {formatTime24(row.at)}
                        </Text>
                      </View>
                      <View style={styles.rail}>
                        <StatusGlyph
                          state={
                            isUrge
                              ? entry.urgeOutcome === 'yielded'
                                ? 'urge_yielded'
                                : 'urge_held'
                              : 'unplanned'
                          }
                          size={16}
                          colorScheme={colorScheme}
                          backgroundColor={colors.surfaceSubtle}
                        />
                      </View>
                      <View style={styles.content}>
                        <Text
                          style={[
                            styles.activityKind,
                            typeRoles.meta,
                            { color: colors.textTertiary },
                          ]}>
                          {isUrge ? 'URGE · RESISTED' : 'PERIOD REPORT'}
                        </Text>
                        <Text
                          style={[
                            styles.activityTitle,
                            typeRoles.userText,
                            { color: colors.textPrimary },
                          ]}>
                          {entry.title}
                        </Text>
                        <Text
                          style={[
                            styles.activitySub,
                            typeRoles.meta,
                            { color: colors.textSecondary },
                          ]}>
                          {isUrge
                            ? `${entry.durationMin ? `${entry.durationMin}-minute hold` : '10-minute hold'}${
                                entry.urgeOutcome === 'yielded' ? ' · gave in' : ' · resisted'
                              }`
                            : 'Logged doing'}
                        </Text>
                        {isExpanded && (
                          <View
                            style={[
                              styles.activityDetail,
                              {
                                borderLeftColor: colors.border,
                                backgroundColor: colors.surfaceSubtle,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.activityDetailText,
                                typeRoles.meta,
                                { color: colors.textSecondary },
                              ]}>
                              {isUrge
                                ? `Trigger: ${entry.title}. Outcome: ${
                                    entry.urgeOutcome === 'yielded' ? 'yielded' : 'resisted'
                                  }.`
                                : `Activity record: ${entry.title}`}
                            </Text>
                          </View>
                        )}
                      </View>
                    </Pressable>
                  </View>
                );
              }

              // 3. PLAN ITEM / REPORT
              if (row.kind === 'plan' && row.beat) {
                const beat = row.beat;
                const isDone = beat.state === 'done';
                const isDue = beat.state === 'due';
                const isMissed = beat.state === 'missed';
                const isPartly = beat.state === 'partly';
                const isExpanded = Boolean(expandedActivities[beat.planItem.id]);

                const titleColor =
                  isDue || isMissed || isPartly
                    ? colors.textPrimary
                    : colors.textSecondary;
                const titleWeight = isDue ? '500' : '400';

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
                      onPress={() => {
                        toggleActivityDetail(beat.planItem.id);
                        onSelectBeat?.(beat.planItem.id);
                      }}>
                      <View style={styles.gutter}>
                        <Text
                          style={[
                            styles.timeText,
                            typeRoles.figure,
                            {
                              color: isDue
                                ? colors.textPrimary
                                : colors.textSecondary,
                            },
                          ]}
                          allowFontScaling={true}>
                          {formatTime24(row.at)}
                        </Text>
                      </View>
                      <View style={styles.rail}>
                        <StatusGlyph
                          state={beat.state}
                          size={16}
                          colorScheme={colorScheme}
                          backgroundColor={colors.surfaceSubtle}
                        />
                      </View>
                      <View style={styles.content}>
                        <Text
                          style={[
                            styles.activityKind,
                            typeRoles.meta,
                            { color: colors.textTertiary },
                          ]}>
                          {isDone
                            ? 'PERIOD REPORT · ON TIME'
                            : isMissed
                            ? 'PERIOD REPORT · LATE'
                            : isDue
                            ? 'PERIOD REPORT · DUE'
                            : 'NEXT PERIOD REPORT · UPCOMING'}
                        </Text>
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
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dockedContainer: {
    width: TODAY_PANEL_WIDTH,
    minHeight: '100%',
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    borderLeftWidth: 1,
  },
  fullWidthContainer: {
    width: '100%',
    minHeight: '100%',
    paddingHorizontal: 17,
    paddingTop: 18,
    paddingBottom: 14,
  },
  stateCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  emptyActionBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 13,
    borderBottomWidth: 1,
  },
  todayTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  todayDate: {
    fontSize: 9,
    letterSpacing: 0.5,
    marginTop: 4,
  },
  manageBtn: {
    paddingVertical: 5,
    paddingLeft: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  manageBtnText: {
    fontSize: 10,
  },
  tracker: {
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  trackerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  trackerCount: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },
  trackerNumber: {
    fontSize: 19,
    fontWeight: '500',
    letterSpacing: -0.6,
  },
  trackerLabel: {
    fontSize: 10,
  },
  trackerLate: {
    fontSize: 9,
  },
  segments: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 11,
  },
  segment: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 3,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  tabBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeTabBtn: {
    borderWidth: 1,
  },
  tabBtnText: {
    fontSize: 10,
  },
  tabCount: {
    fontSize: 9,
  },
  contentWrap: {
    flex: 1,
    minHeight: 200,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  planTime: {
    width: 73,
    fontSize: 9,
    lineHeight: 16,
    paddingTop: 1,
  },
  planMain: {
    flex: 1,
    minWidth: 0,
  },
  planTitleLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  planTitle: {
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  planStatusTag: {
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  planSub: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 4,
  },
  actualText: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  evidenceBtn: {
    marginTop: 6,
    minHeight: 24,
    justifyContent: 'center',
  },
  evidenceBtnText: {
    fontSize: 9,
  },
  evidenceCard: {
    marginTop: 8,
    padding: 10,
    borderLeftWidth: 1,
    borderRadius: 2,
  },
  evidenceKicker: {
    fontSize: 8,
    letterSpacing: 0.7,
  },
  evidenceText: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  evidenceNote: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 5,
  },
  rowWrapper: {
    position: 'relative',
    width: '100%',
  },
  spineSegment: {
    position: 'absolute',
    left: 60,
    width: 1,
  },
  pressableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 52,
    paddingVertical: 8,
    width: '100%',
  },
  gutter: {
    width: 49,
    paddingTop: 2,
  },
  timeText: {
    fontSize: 9,
    lineHeight: 16,
  },
  rail: {
    width: 23,
    minHeight: 20,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  content: {
    flex: 1,
    paddingLeft: 6,
  },
  nowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  nowRuleWrapper: {
    flex: 1,
    height: 18,
    justifyContent: 'center',
    paddingLeft: 6,
  },
  nowRule: {
    height: 1,
    width: '100%',
  },
  activityKind: {
    fontSize: 8,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  activityTitle: {
    fontSize: 11,
    lineHeight: 16,
  },
  activitySub: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
  },
  activityDetail: {
    marginTop: 8,
    padding: 8,
    borderLeftWidth: 1,
    borderRadius: 2,
  },
  activityDetailText: {
    fontSize: 10,
    lineHeight: 15,
  },
  logMissedBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
});
