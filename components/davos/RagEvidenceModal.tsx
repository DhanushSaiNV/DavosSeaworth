// components/davos/RagEvidenceModal.tsx
// Developer and beta-tester diagnostic overlay for inspecting RAG retrieved evidence.
// Features:
// 1. Plan summary (status, request ledger, char counts, refinement flag).
// 2. Expandable dataset blocks with stated cognitive purpose and retrieved row counts.
// 3. Formatted card inspection for retrieved records with raw JSON mode.
// 4. Strict adherence to AGENTS.md §7: RN primitives only, zero console.*, 44pt touch targets.

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';

export interface RagEvidenceModalProps {
  visible: boolean;
  onClose: () => void;
  probe?: {
    plan?: string;
    requested?: number;
    returned?: number;
    chars?: number;
    refined?: boolean;
    blocks?: number;
    total_chars?: number;
    omitted?: number;
    bundle_incomplete?: boolean;
    generation_requests?: number;
  } | null;
  blocks?: Array<{
    dataset: string;
    op: string;
    retrieval_method?: string;
    priority?: string;
    purpose?: string;
    row_count?: number;
    rows_returned?: number;
    complete?: boolean;
    state?: string;
    limitations?: string[];
    rows?: Array<Record<string, unknown>>;
  }> | null;
}

export function RagEvidenceModal({
  visible,
  onClose,
  probe,
  blocks = [],
}: RagEvidenceModalProps) {
  const { colors } = useTheme();
  const [expandedDatasets, setExpandedDatasets] = useState<Record<string, boolean>>({});
  const [showRawJson, setShowRawJson] = useState<boolean>(false);

  const toggleDataset = (datasetKey: string) => {
    setExpandedDatasets((prev) => ({
      ...prev,
      [datasetKey]: !prev[datasetKey],
    }));
  };

  const safeBlocks = blocks ?? [];
  const hasBlocks = safeBlocks.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View style={[styles.modalSheet, { backgroundColor: colors.surfaceSubtle }]}>
          {/* Header */}
          <View
            style={[
              styles.headerRow,
              { borderBottomColor: colors.borderSubtle },
            ]}>
            <View style={styles.headerTitleWrap}>
              <View style={styles.titleWithBadge}>
                <Text
                  style={[
                    styles.headerTitle,
                    typeRoles.heading,
                    { color: colors.textPrimary, fontWeight: '700' },
                  ]}
                  allowFontScaling={true}>
                  RAG Evidence Inspector
                </Text>
                <View
                  style={[
                    styles.tagBadge,
                    { backgroundColor: colors.lanternSurface },
                  ]}>
                  <Text
                    style={[
                      styles.tagBadgeText,
                      typeRoles.meta,
                      { color: colors.lantern, fontWeight: '700' },
                    ]}
                    allowFontScaling={true}>
                    DEV DEBUG
                  </Text>
                </View>
              </View>
              <Text
                style={[
                  styles.headerSubtitle,
                  typeRoles.meta,
                  { color: colors.textTertiary },
                ]}
                allowFontScaling={true}>
                Model-directed cognitive planning & retrieved datasets
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close RAG inspector"
              hitSlop={touchTarget.hitSlop}
              style={[
                styles.closeButton,
                { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
              ]}
              onPress={onClose}>
              <Text
                style={[
                  styles.closeButtonText,
                  typeRoles.meta,
                  { color: colors.textPrimary, fontWeight: '600' },
                ]}
                allowFontScaling={true}>
                ✕
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollContent}
            contentContainerStyle={styles.scrollContentContainer}>
            {/* 1. Turn Metrics Overview */}
            <View
              style={[
                styles.overviewCard,
                { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
              ]}>
              <Text
                style={[
                  styles.sectionHeader,
                  typeRoles.meta,
                  { color: colors.textSecondary, fontWeight: '700' },
                ]}
                allowFontScaling={true}>
                TURN METRICS
              </Text>

              <View style={styles.metricGrid}>
                <View style={styles.metricBox}>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textTertiary }]}
                    allowFontScaling={true}>
                    Plan State
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      typeRoles.figure,
                      {
                        color:
                          probe?.plan === 'ok'
                            ? colors.lantern
                            : colors.textSecondary,
                        fontWeight: '700',
                      },
                    ]}
                    allowFontScaling={true}>
                    {probe?.plan ? probe.plan.toUpperCase() : 'UNKNOWN'}
                  </Text>
                </View>

                <View style={styles.metricBox}>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textTertiary }]}
                    allowFontScaling={true}>
                    Datasets
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      typeRoles.figure,
                      { color: colors.textPrimary, fontWeight: '700' },
                    ]}
                    allowFontScaling={true}>
                    {safeBlocks.length}
                  </Text>
                </View>

                <View style={styles.metricBox}>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textTertiary }]}
                    allowFontScaling={true}>
                    Evidence Chars
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      typeRoles.figure,
                      { color: colors.textPrimary, fontWeight: '700' },
                    ]}
                    allowFontScaling={true}>
                    {probe?.total_chars ?? probe?.chars ?? 0}
                  </Text>
                </View>

                <View style={styles.metricBox}>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textTertiary }]}
                    allowFontScaling={true}>
                    Requests
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      typeRoles.figure,
                      { color: colors.textPrimary, fontWeight: '700' },
                    ]}
                    allowFontScaling={true}>
                    {probe?.generation_requests ?? 1}
                  </Text>
                </View>

                <View style={styles.metricBox}>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textTertiary }]}
                    allowFontScaling={true}>
                    Refinement
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      typeRoles.figure,
                      {
                        color: probe?.refined ? colors.lantern : colors.textTertiary,
                        fontWeight: '700',
                      },
                    ]}
                    allowFontScaling={true}>
                    {probe?.refined ? 'YES' : 'NO'}
                  </Text>
                </View>

                <View style={styles.metricBox}>
                  <Text
                    style={[styles.metricLabel, typeRoles.meta, { color: colors.textTertiary }]}
                    allowFontScaling={true}>
                    Incomplete
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      typeRoles.figure,
                      {
                        color: probe?.bundle_incomplete ? colors.danger : colors.textTertiary,
                        fontWeight: '700',
                      },
                    ]}
                    allowFontScaling={true}>
                    {probe?.bundle_incomplete ? 'YES' : 'NO'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Toggle Raw JSON vs Structured View */}
            <View style={styles.toolbarRow}>
              <Text
                style={[
                  styles.sectionHeader,
                  typeRoles.meta,
                  { color: colors.textSecondary, fontWeight: '700' },
                ]}
                allowFontScaling={true}>
                RETRIEVED EVIDENCE BLOCKS ({safeBlocks.length})
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showRawJson ? 'Switch to Card view' : 'Switch to Raw JSON view'}
                hitSlop={touchTarget.hitSlop}
                style={[
                  styles.rawToggleBtn,
                  {
                    backgroundColor: showRawJson
                      ? colors.lanternSurface
                      : colors.surfaceSubtle,
                    borderColor: colors.borderSubtle,
                  },
                ]}
                onPress={() => setShowRawJson(!showRawJson)}>
                <Text
                  style={[
                    styles.rawToggleText,
                    typeRoles.meta,
                    {
                      color: showRawJson ? colors.lantern : colors.textSecondary,
                      fontWeight: '600',
                    },
                  ]}
                  allowFontScaling={true}>
                  {showRawJson ? 'Card View' : 'Raw JSON'}
                </Text>
              </Pressable>
            </View>

            {/* 2. Retrieved Evidence Blocks List */}
            {!hasBlocks ? (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
                ]}>
                <Text
                  style={[
                    styles.emptyTitle,
                    typeRoles.davosVoice,
                    { color: colors.textPrimary, fontWeight: '600' },
                  ]}
                  allowFontScaling={true}>
                  Direct Parametric Reasoning
                </Text>
                <Text
                  style={[
                    styles.emptyText,
                    typeRoles.meta,
                    { color: colors.textTertiary },
                  ]}
                  allowFontScaling={true}>
                  No external personal datasets were requested for this turn. The model answered
                  directly from conversational context and system instructions.
                </Text>
              </View>
            ) : showRawJson ? (
              <View
                style={[
                  styles.rawJsonBox,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
                ]}>
                <Text
                  style={[
                    styles.rawJsonText,
                    typeRoles.figure,
                    { color: colors.textPrimary },
                  ]}
                  selectable={true}
                  allowFontScaling={true}>
                  {JSON.stringify(safeBlocks, null, 2)}
                </Text>
              </View>
            ) : (
              safeBlocks.map((block, idx) => {
                const key = `${block.dataset}_${idx}`;
                const isExpanded = expandedDatasets[key] ?? true;
                const rows = block.rows ?? [];

                return (
                  <View
                    key={key}
                    style={[
                      styles.blockCard,
                      { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
                    ]}>
                    {/* Block Header */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${block.dataset} dataset block. Tap to ${isExpanded ? 'collapse' : 'expand'}.`}
                      style={styles.blockHeaderPressable}
                      onPress={() => toggleDataset(key)}>
                      <View style={styles.blockHeaderLeft}>
                        <View style={styles.blockBadgesRow}>
                          <View
                            style={[
                              styles.datasetPill,
                              { backgroundColor: colors.lanternSurface },
                            ]}>
                            <Text
                              style={[
                                styles.datasetPillText,
                                typeRoles.meta,
                                { color: colors.lantern, fontWeight: '700' },
                              ]}
                              allowFontScaling={true}>
                              {block.dataset}
                            </Text>
                          </View>

                          <View
                            style={[
                              styles.opPill,
                              { backgroundColor: colors.surfaceSubtle },
                            ]}>
                            <Text
                              style={[
                                styles.opPillText,
                                typeRoles.meta,
                                { color: colors.textSecondary },
                              ]}
                              allowFontScaling={true}>
                              {block.op}
                              {block.retrieval_method ? ` · ${block.retrieval_method}` : ''}
                            </Text>
                          </View>

                          {block.priority && (
                            <View
                              style={[
                                styles.priorityPill,
                                {
                                  backgroundColor:
                                    block.priority === 'essential'
                                      ? colors.lanternSurface
                                      : colors.surfaceSubtle,
                                },
                              ]}>
                              <Text
                                style={[
                                  styles.priorityPillText,
                                  typeRoles.meta,
                                  {
                                    color:
                                      block.priority === 'essential'
                                        ? colors.lantern
                                        : colors.textTertiary,
                                    fontWeight: '600',
                                  },
                                ]}
                                allowFontScaling={true}>
                                {block.priority}
                              </Text>
                            </View>
                          )}
                        </View>

                        {/* Stated Purpose */}
                        {block.purpose && (
                          <Text
                            style={[
                              styles.purposeText,
                              typeRoles.meta,
                              { color: colors.textSecondary },
                            ]}
                            allowFontScaling={true}>
                            {`"${block.purpose}"`}
                          </Text>
                        )}
                      </View>

                      <View style={styles.blockHeaderRight}>
                        <Text
                          style={[
                            styles.rowCountBadge,
                            typeRoles.figure,
                            { color: colors.textPrimary, fontWeight: '700' },
                          ]}
                          allowFontScaling={true}>
                          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
                        </Text>
                        <Text
                          style={[
                            styles.chevronText,
                            typeRoles.meta,
                            { color: colors.textTertiary },
                          ]}
                          allowFontScaling={true}>
                          {isExpanded ? '▲' : '▼'}
                        </Text>
                      </View>
                    </Pressable>

                    {/* Block Body (Rows) */}
                    {isExpanded && (
                      <View style={styles.blockBody}>
                        {rows.length === 0 ? (
                          <Text
                            style={[
                              styles.noRowsText,
                              typeRoles.meta,
                              { color: colors.textTertiary },
                            ]}
                            allowFontScaling={true}>
                            0 records returned for this query.
                          </Text>
                        ) : (
                          rows.map((row, rowIdx) => (
                            <View
                              key={`${key}_row_${rowIdx}`}
                              style={[
                                styles.rowCard,
                                {
                                  backgroundColor: colors.surfaceSubtle,
                                  borderLeftColor: colors.lantern,
                                },
                              ]}>
                              {Object.entries(row).map(([k, val]) => (
                                <View key={k} style={styles.rowPropLine}>
                                  <Text
                                    style={[
                                      styles.propKey,
                                      typeRoles.meta,
                                      { color: colors.textTertiary, fontWeight: '600' },
                                    ]}
                                    allowFontScaling={true}>
                                    {k}:
                                  </Text>
                                  <Text
                                    style={[
                                      styles.propVal,
                                      typeRoles.meta,
                                      { color: colors.textPrimary },
                                    ]}
                                    selectable={true}
                                    allowFontScaling={true}>
                                    {typeof val === 'object' && val !== null
                                      ? JSON.stringify(val)
                                      : String(val)}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ))
                        )}

                        {block.limitations && block.limitations.length > 0 && (
                          <View style={styles.limitationsWrap}>
                            <Text
                              style={[
                                styles.limitationsLabel,
                                typeRoles.meta,
                                { color: colors.danger, fontWeight: '600' },
                              ]}
                              allowFontScaling={true}>
                              Limitations: {block.limitations.join(', ')}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    height: '88%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  headerTitleWrap: {
    flex: 1,
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    letterSpacing: -0.2,
  },
  tagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  tagBadgeText: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 14,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  overviewCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  sectionHeader: {
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metricBox: {
    minWidth: '28%',
    flex: 1,
    paddingVertical: 6,
  },
  metricLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 14,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  rawToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  rawToggleText: {
    fontSize: 11,
  },
  emptyCard: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  rawJsonBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  rawJsonText: {
    fontFamily: 'Courier',
    fontSize: 11,
    lineHeight: 16,
  },
  blockCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  blockHeaderPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
    minHeight: 48,
  },
  blockHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  blockBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  datasetPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  datasetPillText: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
  opPill: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  opPillText: {
    fontSize: 10,
  },
  priorityPill: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  priorityPillText: {
    fontSize: 10,
  },
  purposeText: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  blockHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: spacing.xs,
  },
  rowCountBadge: {
    fontSize: 12,
  },
  chevronText: {
    fontSize: 10,
  },
  blockBody: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  noRowsText: {
    fontSize: 11,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  rowCard: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    gap: 2,
  },
  rowPropLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  propKey: {
    fontSize: 11,
  },
  propVal: {
    fontSize: 11,
    flexShrink: 1,
  },
  limitationsWrap: {
    marginTop: 4,
  },
  limitationsLabel: {
    fontSize: 10,
  },
});
