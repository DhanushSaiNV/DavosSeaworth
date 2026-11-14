// components/davos/JournalEditor.tsx
// Canonical component for Object: Journal (PRD §3.4, §4.4, §12; TECH-SPEC §3.4, §7.4).
// Distraction-free evening journal editor with block-level Unsavable privacy flags,
// post-strip preview, 5-second undo recovery latch, and submit state flow.
// Strictly uses theme/roles.ts. Touch target >= 44dp. RN primitives only.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { splitBlocks, stripSummary, type Block } from '../../lib/journal/strip';
import {
  loadJournalDraft,
  saveJournalDraft,
  clearJournalDraft,
  submitJournalEntry,
  simulateOvernightAnchorPlan,
  JournalDraft,
} from '../../lib/journal/journalService';
import { UndoToast } from './UndoToast';
import { Icon } from '../ui/Icon';
import {
  hapticImpactLight,
  hapticNotifySuccess,
  hapticSelection,
} from '../../lib/haptics';

export interface JournalEditorProps {
  userId?: string;
  onClose?: () => void;
  onSuccess?: () => void;
  colorScheme?: 'light' | 'dark';
}

export function JournalEditor({
  userId = '',
  onClose,
  onSuccess,
  colorScheme,
}: JournalEditorProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  const [raw, setRaw] = useState('');
  const [flaggedTexts, setFlaggedTexts] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Undo latch states
  const [pendingSubmission, setPendingSubmission] = useState<boolean>(false);
  const [undoSeconds, setUndoSeconds] = useState<number>(0);
  const undoTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Confirmation state
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [submittedSummary, setSubmittedSummary] = useState<{ sent: number; total: number } | null>(null);
  const [isSimulatingWakeup, setIsSimulatingWakeup] = useState(false);

  // Synchronous paragraph block parsing (pure function)
  const blocks = useMemo(() => splitBlocks(raw), [raw]);

  // Load draft on mount
  useEffect(() => {
    let cancelled = false;
    loadJournalDraft()
      .then((draft) => {
        if (!cancelled && draft) {
          setRaw(draft.raw);
          setFlaggedTexts(draft.flaggedTexts);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });

    return () => {
      cancelled = true;
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    };
  }, []);

  // Persist draft on edit
  useEffect(() => {
    if (!isLoaded || isConfirmed) return;
    const timer = setTimeout(() => {
      if (raw.trim() || flaggedTexts.length > 0) {
        void saveJournalDraft({
          raw,
          flaggedTexts,
          updatedAt: new Date().toISOString(),
        });
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [raw, flaggedTexts, isLoaded, isConfirmed]);

  const flaggedSet = useMemo(() => new Set(flaggedTexts), [flaggedTexts]);
  const summary = useMemo(() => stripSummary(raw, flaggedSet), [raw, flaggedSet]);

  const wordCount = useMemo(() => {
    const trimmed = raw.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [raw]);

  // Toggle unsavable status for a block
  const handleToggleBlock = useCallback(
    (blockText: string) => {
      void hapticSelection();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFlaggedTexts((prev) => {
        const next = new Set(prev);
        if (next.has(blockText)) {
          next.delete(blockText);
        } else {
          next.add(blockText);
        }
        return Array.from(next);
      });
    },
    []
  );

  // Execute real network submission
  const executeSubmission = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await submitJournalEntry(raw, flaggedSet);
    setIsSubmitting(false);

    if (result.ok) {
      void hapticNotifySuccess();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsConfirmed(true);
      setSubmittedSummary({
        sent: result.sentBlocks ?? summary.sent,
        total: result.totalBlocks ?? summary.total,
      });
      await clearJournalDraft();
    } else {
      setErrorMessage(result.error || 'Failed to submit journal.');
    }
  };

  // Start 5-second reversible latch
  const handleStartSubmitLatch = () => {
    if (summary.total === 0 || summary.sent === 0) return;
    void hapticImpactLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPendingSubmission(true);
    setUndoSeconds(5);

    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    undoTimerRef.current = setInterval(() => {
      setUndoSeconds((prev) => {
        if (prev <= 1) {
          if (undoTimerRef.current) clearInterval(undoTimerRef.current);
          setPendingSubmission(false);
          void executeSubmission();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Undo submission
  const handleUndoSubmission = () => {
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    void hapticImpactLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPendingSubmission(false);
    setUndoSeconds(0);
  };

  // Simulate morning wakeup & plan generation
  const handleSimulateMorning = async () => {
    setIsSimulatingWakeup(true);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateStr = tomorrow.toISOString().split('T')[0];

    await simulateOvernightAnchorPlan(userId, tomorrowDateStr, raw);
    setIsSimulatingWakeup(false);
    void hapticNotifySuccess();
    onSuccess?.();
    onClose?.();
  };

  // State: Confirmed
  if (isConfirmed) {
    return (
      <View style={styles.content}>
        <View style={styles.confirmedHeader}>
          <Text
            style={[styles.confirmedTitle, typeRoles.heading, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Journal Submitted
          </Text>
          <Text
            style={[styles.confirmedSub, typeRoles.davosVoice, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Davos received {submittedSummary?.sent ?? summary.sent} of{' '}
            {submittedSummary?.total ?? summary.total} paragraphs. Your unflagged thoughts
            will be reviewed overnight, and a customized deadline-bound anchor plan will be
            generated for tomorrow morning.
          </Text>
        </View>

        <View style={styles.confirmedActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Simulate morning wakeup and generate plan now"
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle }}
            style={({ pressed }) => [
              styles.actionButton,
              { borderColor: colors.controlBorder },
              pressed && { opacity: 0.7 },
            ]}
            disabled={isSimulatingWakeup}
            onPress={handleSimulateMorning}>
            <Text
              style={[
                styles.actionButtonText,
                typeRoles.davosVoice,
                { color: colors.textPrimary, fontWeight: '500' },
              ]}
              allowFontScaling={true}>
              {isSimulatingWakeup ? 'Generating plan…' : 'Simulate Morning Wakeup (Preview)'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle }}
            style={({ pressed }) => [
              styles.actionButton,
              { borderColor: colors.controlBorder, backgroundColor: colors.accent },
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              void hapticSelection();
              onSuccess?.();
              onClose?.();
            }}>
            <Text
              style={[
                styles.actionButtonText,
                typeRoles.davosVoice,
                { color: colors.onAccent, fontWeight: '600' },
              ]}
              allowFontScaling={true}>
              Return to Davos
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const isSubmitDisabled =
    isSubmitting ||
    pendingSubmission ||
    summary.total === 0 ||
    summary.sent === 0 ||
    !raw.trim();

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled">
      {/* 1. Header instructions */}
      <View style={styles.headerBlock}>
        <Text
          style={[styles.headerTitle, typeRoles.heading, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          Evening Journal
        </Text>
        <Text
          style={[styles.headerSubtitle, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Raw brain dump. Davos will read permitted paragraphs overnight to generate tomorrow's
          anchor plan. Tap any paragraph to mark it Unsavable before sending.
        </Text>
      </View>

      {/* 2. Distraction-Free Text Input */}
      <View style={[styles.inputContainer, { borderBottomColor: colors.divider }]}>
        <TextInput
          multiline
          value={raw}
          onChangeText={setRaw}
          placeholder="What went well today? What slipped? Write freely..."
          placeholderTextColor={colors.disabled}
          cursorColor={colors.accent}
          selectionColor={colors.accentSubtle}
          underlineColorAndroid="transparent"
          style={[
            styles.textarea,
            typeRoles.userText,
            { color: colors.textPrimary },
          ]}
          allowFontScaling={true}
          autoFocus={false}
        />

        <View style={styles.telemetryRow}>
          <Text
            style={[styles.telemetryText, typeRoles.figure, { color: colors.textTertiary }]}
            allowFontScaling={true}>
            {wordCount} {wordCount === 1 ? 'word' : 'words'} · saved on device
          </Text>
        </View>
      </View>

      {/* 3. Permissioned Extraction: Paragraph Block Review */}
      {blocks.length > 0 && (
        <View style={styles.reviewSection}>
          <View style={styles.reviewHeaderRow}>
            <Text
              style={[styles.sectionHeading, typeRoles.heading, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Privacy & Extraction Flags
            </Text>
            <Text
              style={[styles.sectionMeta, typeRoles.meta, { color: colors.textSecondary }]}
              allowFontScaling={true}>
              {summary.sent} of {summary.total} sent
            </Text>
          </View>

          <Text
            style={[styles.reviewHint, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Tap a paragraph below to toggle Unsavable. Flagged paragraphs are stripped
            client-side and never touch Davos's servers.
          </Text>

          {blocks.map((block, index) => {
            const isFlagged = flaggedSet.has(block.text);
            return (
              <Pressable
                key={`${index}_${block.start}`}
                accessibilityRole="button"
                accessibilityLabel={`Paragraph ${index + 1}: ${block.text}. ${
                  isFlagged ? 'Flagged unsavable. Tap to include.' : 'Included. Tap to mark unsavable.'
                }`}
                hitSlop={touchTarget.hitSlop}
                android_ripple={{ color: colors.borderSubtle }}
                style={({ pressed }) => [
                  styles.blockRow,
                  { borderBottomColor: colors.divider },
                  isFlagged && { opacity: 0.6 },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => handleToggleBlock(block.text)}>
                <View style={styles.blockContent}>
                  <Text
                    style={[
                      styles.blockText,
                      typeRoles.userText,
                      { color: isFlagged ? colors.textTertiary : colors.textPrimary },
                      isFlagged && styles.strikethroughText,
                    ]}
                    allowFontScaling={true}>
                    {block.text}
                  </Text>
                </View>

                <View style={styles.blockStatus}>
                  <Text
                    style={[
                      styles.badgeText,
                      typeRoles.meta,
                      {
                        color: isFlagged ? colors.danger : colors.textSecondary,
                        fontWeight: isFlagged ? '700' : '500',
                      },
                    ]}
                    allowFontScaling={true}>
                    {isFlagged ? 'UNSAVABLE' : 'Will be sent'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* 4. Sanitized Preview Collapsible */}
      {blocks.length > 0 && (
        <View style={styles.previewSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${showPreview ? 'Hide' : 'Show'} post-strip preview`}
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle }}
            style={({ pressed }) => [
              styles.previewToggleBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              void hapticSelection();
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setShowPreview((prev) => !prev);
            }}>
            <Icon
              name={showPreview ? 'chevron-up' : 'chevron-down'}
              size="sm"
              color={colors.textSecondary}
            />
            <Text
              style={[
                styles.previewToggleText,
                typeRoles.davosVoice,
                { color: colors.textPrimary, fontWeight: '500' },
              ]}
              allowFontScaling={true}>
              {showPreview ? 'Hide sanitized preview' : 'Preview what Davos receives'}
            </Text>
          </Pressable>

          {showPreview && (
            <View
              style={[
                styles.previewBox,
                { borderLeftColor: colors.controlBorder, borderLeftWidth: 2 },
              ]}>
              <Text
                style={[
                  styles.previewContent,
                  typeRoles.userText,
                  { color: summary.stripped ? colors.textPrimary : colors.textTertiary },
                ]}
                allowFontScaling={true}>
                {summary.stripped || '(Nothing will be transmitted — all paragraphs flagged Unsavable)'}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* 5. Error message */}
      {errorMessage && (
        <View style={styles.errorContainer}>
          <Text
            style={[styles.errorText, typeRoles.meta, { color: colors.danger }]}
            allowFontScaling={true}>
            {errorMessage}
          </Text>
        </View>
      )}

      {/* 6. Undo Latch Toast */}
      {pendingSubmission && (
        <View style={styles.undoContainer}>
          <UndoToast
            label="Sending journal..."
            timeout={undoSeconds}
            onUndo={handleUndoSubmission}
          />
        </View>
      )}

      {/* 7. Action Button */}
      <View style={styles.submitRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send journal to Davos"
          disabled={isSubmitDisabled}
          hitSlop={touchTarget.hitSlop}
          android_ripple={{ color: colors.onAccent + '33' }}
          style={({ pressed }) => [
            styles.submitButton,
            {
              backgroundColor: isSubmitDisabled ? colors.divider : colors.accent,
            },
            pressed && !isSubmitDisabled && { opacity: 0.8 },
          ]}
          onPress={handleStartSubmitLatch}>
          <Text
            style={[
              styles.submitButtonText,
              typeRoles.davosVoice,
              { color: isSubmitDisabled ? colors.disabled : colors.onAccent, fontWeight: '600' },
            ]}
            allowFontScaling={true}>
            {isSubmitting
              ? 'Sending…'
              : pendingSubmission
              ? `Sending in ${undoSeconds}s…`
              : 'Send to Davos'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    width: '100%',
    maxWidth: 580,
    alignSelf: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    width: '100%',
    maxWidth: 580,
    alignSelf: 'center',
  },
  headerBlock: {
    marginBottom: spacing.md,
  },
  headerTitle: {
    marginBottom: spacing.xxs,
  },
  headerSubtitle: {
    lineHeight: 20,
  },
  inputContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.sm,
    marginBottom: spacing.lg,
  },
  textarea: {
    minHeight: 180,
    textAlignVertical: 'top',
    paddingVertical: spacing.sm,
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  telemetryText: {
    fontSize: 12,
  },
  reviewSection: {
    marginBottom: spacing.lg,
  },
  reviewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xxs,
  },
  sectionHeading: {
    fontSize: 18,
  },
  sectionMeta: {},
  reviewHint: {
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    minHeight: touchTarget.minTargetIos,
  },
  blockContent: {
    flex: 1,
  },
  blockText: {
    lineHeight: 22,
  },
  strikethroughText: {
    textDecorationLine: 'line-through',
  },
  blockStatus: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    minWidth: 80,
  },
  badgeText: {
    fontSize: 11,
  },
  previewSection: {
    marginBottom: spacing.lg,
  },
  previewToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.minTargetIos,
    paddingVertical: spacing.xs,
  },
  previewToggleText: {
    fontSize: 15,
  },
  previewBox: {
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  previewContent: {
    lineHeight: 22,
    fontStyle: 'normal',
  },
  errorContainer: {
    marginBottom: spacing.md,
  },
  errorText: {},
  undoContainer: {
    marginBottom: spacing.md,
  },
  submitRow: {
    marginTop: spacing.sm,
  },
  submitButton: {
    minHeight: touchTarget.minTargetIos,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  submitButtonText: {
    fontSize: 16,
  },
  confirmedHeader: {
    marginBottom: spacing.xl,
  },
  confirmedTitle: {
    marginBottom: spacing.xs,
  },
  confirmedSub: {
    lineHeight: 24,
  },
  confirmedActions: {
    gap: spacing.md,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionButtonText: {
    fontSize: 15,
  },
});
