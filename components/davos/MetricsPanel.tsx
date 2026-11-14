// components/davos/MetricsPanel.tsx
// Canonical component for Life Metrics (PRD §3.5, §4.5; TECH-SPEC §7.9; FP-07).
// Renders the user's active life metrics, trend lines, heatmaps, and quest progress.
// Four view states: loading, empty, populated, error.
// Pure RN primitives only (View, Text, Pressable, ScrollView). Tokens via useTheme.

import React, { useState } from 'react';
import {
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';
import { hapticSelection } from '../../lib/haptics';
import { LoadingMark } from '../ui/LoadingMark';
import { MetricItem } from '../metrics/MetricItem';
import {
  CORE_METRIC_PRESETS,
  type MetricPresetInfo,
} from '../../lib/metricsService';
import type { MetricView } from '../../lib/metricsData';

export interface MetricsPanelProps {
  views: MetricView[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  errorMessage?: string | null;
  onRefresh?: () => void;
  lastUpdated?: string;
}

export function MetricsPanel({
  views,
  isLoading = false,
  isRefreshing = false,
  errorMessage = null,
  onRefresh,
  lastUpdated,
}: MetricsPanelProps) {
  const { colors } = useTheme();
  const [showPresetCatalog, setShowPresetCatalog] = useState(false);

  const togglePresetCatalog = () => {
    void hapticSelection();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowPresetCatalog((prev) => !prev);
  };

  // State 1: Loading
  if (isLoading && views.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <View style={[styles.statusNotice, { borderBottomColor: colors.borderSubtle }]}>
          <Text
            style={[styles.statusNoticeText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Loading life metrics…
          </Text>
        </View>
        <View style={styles.loadingCenter}>
          <LoadingMark size="large" />
        </View>
      </View>
    );
  }

  // State 2: Error (without cached data)
  if (errorMessage && views.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <View style={styles.errorContainer}>
          <Text
            style={[styles.errorCopy, typeRoles.meta, { color: colors.danger }]}
            allowFontScaling={true}>
            Can't load metrics. {errorMessage}
          </Text>
          {onRefresh && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading metrics"
              hitSlop={touchTarget.hitSlop}
              android_ripple={{ color: colors.borderSubtle }}
              style={({ pressed }) => [
                styles.actionButton,
                { borderColor: colors.borderSubtle },
                pressed && { opacity: 0.7 },
              ]}
              onPress={onRefresh}>
              <Text
                style={[
                  styles.actionButtonText,
                  typeRoles.davosVoice,
                  { color: colors.textPrimary, fontWeight: '500' },
                ]}
                allowFontScaling={true}>
                Retry
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // State 3: Empty (user has 0 active metrics)
  if (views.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text
            style={[styles.emptyTitle, typeRoles.heading, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            No active metrics yet
          </Text>
          <Text
            style={[styles.emptyCopy, typeRoles.davosVoice, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Davos will propose customized metrics during your check-ins and onboarding. Numbers
            motivate more than hormones.
          </Text>

          {/* Accordion toggle to inspect the 8 standard core metrics */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              showPresetCatalog
                ? 'Hide core metric presets'
                : 'Browse available core metric presets'
            }
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle }}
            style={({ pressed }) => [
              styles.catalogToggleBtn,
              { borderColor: colors.borderSubtle },
              pressed && { opacity: 0.7 },
            ]}
            onPress={togglePresetCatalog}>
            <Text
              style={[
                styles.catalogToggleText,
                typeRoles.meta,
                { color: colors.accent, fontWeight: '600' },
              ]}
              allowFontScaling={true}>
              {showPresetCatalog ? 'Hide metric catalog ↑' : 'Preview core metric catalog ↓'}
            </Text>
          </Pressable>

          {showPresetCatalog && (
            <View style={styles.catalogList}>
              {CORE_METRIC_PRESETS.map((preset: MetricPresetInfo) => (
                <View
                  key={preset.name}
                  style={[styles.presetRow, { borderBottomColor: colors.borderSubtle }]}>
                  <View style={styles.presetTopRow}>
                    <Text
                      style={[styles.presetName, typeRoles.title, { color: colors.textPrimary }]}
                      allowFontScaling={true}>
                      {preset.name}
                    </Text>
                    <Text
                      style={[styles.presetDomain, typeRoles.meta, { color: colors.textTertiary }]}
                      allowFontScaling={true}>
                      {preset.domain} · {preset.output_unit}
                    </Text>
                  </View>
                  <Text
                    style={[styles.presetDesc, typeRoles.meta, { color: colors.textSecondary }]}
                    allowFontScaling={true}>
                    {preset.description}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  // State 4: Populated
  return (
    <View style={styles.container}>
      {/* Panel Header */}
      <View style={[styles.headerRow, { borderBottomColor: colors.borderSubtle }]}>
        <View style={styles.headerTitleCol}>
          <Text
            style={[styles.sectionTitle, typeRoles.heading, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Life Metrics
          </Text>
          <Text
            style={[styles.sectionMeta, typeRoles.meta, { color: colors.textTertiary }]}
            allowFontScaling={true}>
            {views.length} active · evaluated daily at 00:30
          </Text>
        </View>

        {onRefresh && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh life metrics"
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle }}
            disabled={isRefreshing}
            style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.7 }]}
            onPress={onRefresh}>
            <Text
              style={[
                styles.refreshBtnText,
                typeRoles.meta,
                { color: isRefreshing ? colors.disabled : colors.accent },
              ]}
              allowFontScaling={true}>
              {isRefreshing ? 'Refreshing…' : 'Refresh ↻'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Warning banner if refreshing failed but cached data is rendered */}
      {errorMessage && (
        <View style={[styles.warningNotice, { borderBottomColor: colors.borderSubtle }]}>
          <Text
            style={[styles.warningNoticeText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Showing cached data. Could not reach server.
          </Text>
        </View>
      )}

      {/* Metrics List */}
      <View style={styles.metricsList}>
        {views.map((view) => (
          <MetricItem key={view.metric.id} view={view} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    gap: spacing.md,
  },
  stateContainer: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingVertical: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleCol: {
    gap: spacing.xxs,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  sectionMeta: {
    fontSize: 12,
  },
  refreshBtn: {
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  refreshBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  statusNotice: {
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusNoticeText: {
    fontSize: 13,
  },
  warningNotice: {
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  warningNoticeText: {
    fontSize: 12,
  },
  loadingCenter: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  errorCopy: {
    fontSize: 13,
  },
  actionButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  actionButtonText: {
    fontSize: 14,
  },
  emptyContainer: {
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptyCopy: {
    fontSize: 14,
    lineHeight: 20,
  },
  catalogToggleBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  catalogToggleText: {
    fontSize: 13,
  },
  catalogList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  presetRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xxs,
  },
  presetTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  presetName: {
    fontSize: 15,
    fontWeight: '600',
  },
  presetDomain: {
    fontSize: 12,
  },
  presetDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  metricsList: {
    width: '100%',
  },
});
