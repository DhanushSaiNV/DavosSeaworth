import { useCallback, useEffect, useMemo, useRef, useState, useReducer } from 'react';
import { View, TextInput, StyleSheet, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { splitBlocks, stripSummary, type Block } from '../../lib/journal/strip';
import { buildSubmitPayload, submitStateReducer, type SubmitState, isSubmitDisabled } from '../../lib/journal/submitState';
import { useTheme } from '../../theme';
import { Screen, Card, Text, Icon, Badge, Button, EmptyState } from '../../components/ui';
import { hapticNotifySuccess, hapticSelection } from '../../lib/haptics';

// Distraction-free evening journal editor with block-level
// Unsavable flags + post-strip preview. Local only: the draft is persisted
// in AsyncStorage; NOTHING is transmitted. Flagged blocks are stripped client-side by the
// pure stripUnsavable before any future transmission (D3, TECH-SPECS §7.4).
// Features Signature Moment: "Tactile Commitment Latch" with 5-second undo recovery.

const DRAFT_KEY = 'davos_journal_draft';
const REPARSE_DEBOUNCE_MS = 300;
const SAVE_DEBOUNCE_MS = 500;

interface Draft {
  raw: string;
  flaggedTexts: string[];
  updatedAt: string;
  committed?: boolean;
}

export default function JournalScreen() {
  const { colors, spacing, radius } = useTheme();
  const [raw, setRaw] = useState('');
  const [flaggedTexts, setFlaggedTexts] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null);
  const [submitState, submitDispatch] = useReducer(submitStateReducer, { status: "idle" } as SubmitState);

  const rawRef = useRef(raw);
  const flaggedRef = useRef(flaggedTexts);
  const editorRef = useRef<TextInput>(null);
  rawRef.current = raw;
  flaggedRef.current = flaggedTexts;

  // Load the persisted draft once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(DRAFT_KEY);
        if (!cancelled && saved) {
          const draft = JSON.parse(saved) as Draft;
          if (typeof draft.raw === 'string') setRaw(draft.raw);
          if (Array.isArray(draft.flaggedTexts)) {
            setFlaggedTexts(draft.flaggedTexts.filter((t) => typeof t === 'string'));
          }
          if (draft.committed) setCommitted(true);
        }
      } catch {
        // Corrupt draft: start fresh rather than crash.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the draft (debounced) while typing.
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      const draft: Draft = {
        raw: rawRef.current,
        flaggedTexts: flaggedRef.current,
        updatedAt: new Date().toISOString(),
        committed,
      };
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [raw, flaggedTexts, loaded, committed]);

  // Flush the draft on unmount.
  useEffect(() => {
    return () => {
      const draft: Draft = {
        raw: rawRef.current,
        flaggedTexts: flaggedRef.current,
        updatedAt: new Date().toISOString(),
        committed,
      };
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
    };
  }, [committed]);

  // Re-parse blocks (debounced) while typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setBlocks(splitBlocks(rawRef.current));
    }, REPARSE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [raw]);

  // Countdown timer for reversible undo window
  useEffect(() => {
    if (undoCountdown === null) return;
    if (undoCountdown <= 0) {
      setUndoCountdown(null);
      return;
    }
    const interval = setTimeout(() => {
      setUndoCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(interval);
  }, [undoCountdown]);

  const flaggedSet = useMemo(() => new Set(flaggedTexts), [flaggedTexts]);

  const toggleBlock = useCallback((text: string) => {
    void hapticSelection();
    setFlaggedTexts((prev) =>
      prev.includes(text) ? prev.filter((t) => t !== text) : [...prev, text],
    );
  }, []);

  const summary = useMemo(() => stripSummary(raw, flaggedSet), [raw, flaggedSet]);

  const wordCount = useMemo(() => {
    const trimmed = raw.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [raw]);

  const isDisabled = isSubmitDisabled(submitState, raw, flaggedSet);

  // Submit to server — single-flight, no offline queue (R-4)
  const handleSubmit = useCallback(async () => {
    if (isDisabled) return;

    const payload = buildSubmitPayload(raw, flaggedSet);
    if (!payload.content.trim()) return;

    submitDispatch({ type: "SUBMIT" });

    try {
      const { data, error } = await supabase.functions.invoke("submit-journal", {
        body: payload,
        timeout: 30000,
      });
      if (error) throw error;

      if (data?.status === "ok" && data.entry_id) {
        // Clear the draft
        await AsyncStorage.removeItem("davos_journal_draft").catch(() => {});
        // Reset editor
        setRaw("");
        setFlaggedTexts([]);
        setCommitted(false);
        setUndoCountdown(null);
        // Show confirmation
        submitDispatch({ type: "OK", sent: summary.sent, total: summary.total });
        void hapticNotifySuccess();
      } else {
        throw new Error(data?.error ?? "Unknown server response");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submit failed";
      submitDispatch({ type: "FAIL", error: message });
    }
  }, [raw, flaggedSet, isDisabled, summary.sent, summary.total]);

  const handleUndoCommit = useCallback(() => {
    setCommitted(false);
    setUndoCountdown(null);
  }, []);

  const handleDismissConfirmation = useCallback(() => {
    submitDispatch({ type: "DISMISS_CONFIRMATION" });
  }, []);

  const handleRetry = useCallback(() => {
    submitDispatch({ type: "RETRY" });
  }, []);

  return (
    <Screen scrollable maxWidth={640} contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleColumn}>
          <Text role="display" style={styles.title}>
            Journal
          </Text>
          <Text role="body" variant="secondary" style={styles.hint}>
            Write freely. Flag any block Unsavable and it is stripped client-side before transmission.
          </Text>
        </View>
        <View style={styles.headerBadges}>
          <Badge
            label={committed ? 'Committed' : flaggedTexts.length > 0 ? `${flaggedTexts.length} Unsavable` : 'Draft'}
            variant={committed ? 'lantern' : flaggedTexts.length > 0 ? 'danger' : 'neutral'}
            icon
          />
        </View>
      </View>

      {/* Undo Recovery Toast (5-second grace window) */}
      {undoCountdown !== null && (
        <Card
          elevation="raised"
          padding={spacing.xs}
          style={[
            styles.undoToast,
            {
              backgroundColor: colors.lanternSurface,
              borderColor: colors.lantern,
            },
          ]}
        >
          <View style={styles.undoRow}>
            <Icon name="check-circle" size={16} color={colors.lantern} />
            <Text role="caption" variant="lantern" tabular style={styles.undoText}>
              Committed to ledger. Undo available ({undoCountdown}s)
            </Text>
            <Button
              title="Undo commit"
              variant="ghost"
              size="sm"
              onPress={handleUndoCommit}
              accessibilityLabel="Undo journal commitment"
            />
          </View>
        </Card>
      )}

      {/* Confirmation Banner */}
      {submitState.status === "confirmed" && (
        <Card
          elevation="raised"
          padding={spacing.sm}
          style={[
            styles.confirmationBanner,
            { backgroundColor: colors.lanternSurface, borderColor: colors.lantern },
          ]}
        >
          <View style={styles.confirmationRow}>
            <Icon name="check-circle" size={18} color={colors.lantern} />
            <Text role="body" variant="lantern" style={styles.confirmationText}>
              Davos received {submitState.sent} of {submitState.total} blocks; he&apos;ll read it tonight and come back with a plan.
            </Text>
            <Button
              title="Dismiss"
              variant="ghost"
              size="sm"
              onPress={handleDismissConfirmation}
              accessibilityLabel="Dismiss confirmation"
            />
          </View>
        </Card>
      )}

      {/* Error Banner */}
      {submitState.status === "failed" && (
        <Card
          elevation="raised"
          padding={spacing.sm}
          style={[
            styles.errorBanner,
            { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
          ]}
        >
          <View style={styles.errorRow}>
            <Icon name="alert-circle" size={18} color={colors.danger} />
            <Text role="body" variant="danger" style={styles.errorText}>
              {submitState.error}
            </Text>
            <Button
              title="Retry"
              variant="ghost"
              size="sm"
              onPress={handleRetry}
              accessibilityLabel="Retry submission"
            />
          </View>
        </Card>
      )}

      {/* Editor Box */}
      <Card
        elevation="raised"
        padding={spacing.sm}
        style={[
          styles.editorCard,
          committed && {
            borderColor: colors.lantern,
            borderWidth: 1.5,
          },
        ]}
      >
        <TextInput
          ref={editorRef}
          style={[
            styles.editor,
            {
              color: colors.textPrimary,
            },
          ]}
          multiline
          textAlignVertical="top"
          placeholder="Brain dump — thoughts, reflections, honesty. No structure needed."
          placeholderTextColor={colors.textTertiary}
          value={raw}
          onChangeText={(text) => {
            setRaw(text);
            if (committed) {
              setCommitted(false);
              setUndoCountdown(null);
            }
          }}
          accessibilityRole="none"
          accessibilityLabel="Journal reflection editor"
        />

        {/* Telemetry Footer */}
        <View style={[styles.editorFooter, { borderTopColor: colors.borderSubtle }]}>
          <View style={styles.telemetryRow}>
            <Text role="caption" variant="tertiary" tabular>
              {wordCount} words
            </Text>
            <Text role="caption" variant="tertiary" style={styles.telemetryDot}>
              •
            </Text>
            <Text role="caption" variant="tertiary" tabular>
              {raw.length} characters
            </Text>
          </View>

          <Button
            title={
              submitState.status === "in-flight"
                ? "Submitting..."
                : submitState.status === "confirmed"
                ? "Submitted"
                : "Commit entry"
            }
            variant={
              submitState.status === "confirmed" ? "secondary" :
              submitState.status === "in-flight" ? "secondary" : "primary"
            }
            size="sm"
            disabled={isDisabled || submitState.status === "in-flight"}
            onPress={handleSubmit}
            accessibilityLabel={
              submitState.status === "in-flight"
                ? "Submitting reflection to ledger"
                : "Commit reflection to ledger"
            }
          />
        </View>
      </Card>

      {/* Empty State when no text entered */}
      {!raw.trim() && (
        <EmptyState
          title="Ledger at rest"
          description="Take two minutes to unburden thoughts, record what was accomplished, or clear mental friction before tomorrow."
          actionTitle="Start writing"
          onAction={() => editorRef.current?.focus()}
        />
      )}

      {/* Block-level privacy breakdown */}
      {blocks.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text role="title" style={styles.sectionTitle}>
              Privacy Blocks
            </Text>
            <Text role="caption" variant="secondary">
              Tap any block to toggle its client-side Unsavable flag
            </Text>
          </View>

          {blocks.map((b) => {
            const flagged = flaggedSet.has(b.text);
            return (
              <Pressable
                key={`${b.start}:${b.end}`}
                style={({ pressed }) => [
                  styles.block,
                  {
                    backgroundColor: flagged ? colors.dangerSurface : colors.surface,
                    borderColor: flagged ? colors.danger : colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                onPress={() => toggleBlock(b.text)}
                accessibilityRole="button"
                accessibilityState={{ selected: flagged }}
                accessibilityLabel={flagged ? 'Flagged unsavable. Will not leave device.' : 'Saved with reflection'}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  role="body"
                  style={[
                    styles.blockText,
                    flagged ? [styles.blockTextFlagged, { color: colors.textTertiary }] : { color: colors.textPrimary },
                  ]}
                >
                  {b.text}
                </Text>

                <View style={styles.blockAction}>
                  {flagged ? (
                    <View style={styles.flaggedBadge}>
                      <Icon name="lock" size={14} color={colors.dangerText} />
                      <Text role="caption" variant="danger" style={styles.flaggedText}>
                        UNSAVABLE
                      </Text>
                    </View>
                  ) : (
                    <Text role="caption" variant="tertiary" style={styles.saveLabel}>
                      SAVED
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Post-strip Preview Section */}
      <View style={styles.previewContainer}>
        <Pressable
          style={styles.previewToggle}
          onPress={() => {
            void hapticSelection();
            setShowPreview((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${showPreview ? 'Hide' : 'Show'} sanitized preview. ${summary.sent} of ${summary.total} blocks would be sent.`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={styles.toggleLeft}>
            <Icon
              name={showPreview ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.accent}
            />
            <Text role="bodyMedium" variant="primary" style={styles.previewToggleText}>
              {showPreview ? 'Hide' : 'Preview'} what Davos receives
            </Text>
          </View>

          <Badge
            label={`${summary.sent}/${summary.total} blocks`}
            variant={summary.total > 0 && summary.sent === 0 ? 'danger' : 'info'}
            size="sm"
          />
        </Pressable>

        {showPreview && (
          <Card
            elevation="none"
            padding={spacing.sm}
            style={[
              styles.previewBox,
              {
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.border,
              },
            ]}
          >
            {summary.stripped === '' ? (
              <Text role="body" variant="tertiary" style={styles.previewEmpty}>
                (Nothing would be transmitted — all blocks flagged as Unsavable)
              </Text>
            ) : (
              <Text role="body" variant="primary" style={styles.previewText}>
                {summary.stripped}
              </Text>
            )}
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitleColumn: {
    flex: 1,
    marginRight: 12,
  },
  headerBadges: {
    alignItems: 'flex-end',
  },
  title: {
    marginBottom: 4,
  },
  hint: {
    maxWidth: 420,
    lineHeight: 20,
  },
  undoToast: {
    marginBottom: 16,
    borderWidth: 1,
  },
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  undoText: {
    flex: 1,
    marginLeft: 8,
    fontWeight: '600',
  },
  editorCard: {
    marginBottom: 24,
  },
  editor: {
    minHeight: 180,
    fontSize: 16,
    lineHeight: 24,
    padding: 4,
  },
  editorFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  telemetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  telemetryDot: {
    marginHorizontal: 6,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    marginBottom: 2,
  },
  block: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 48,
  },
  blockText: {
    flex: 1,
    lineHeight: 22,
  },
  blockTextFlagged: {
    textDecorationLine: 'line-through',
  },
  blockAction: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingTop: 2,
  },
  flaggedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  flaggedText: {
    fontWeight: '700',
  },
  saveLabel: {
    textTransform: 'uppercase',
  },
  previewContainer: {
    marginTop: 8,
  },
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    minHeight: 44,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewToggleText: {
    marginLeft: 4,
  },
  previewBox: {
    borderWidth: 1,
    marginTop: 8,
  },
  previewText: {
    lineHeight: 22,
  },
  previewEmpty: {
    fontStyle: 'italic',
  },
  confirmationBanner: {
    marginBottom: 16,
    borderWidth: 1,
  },
  confirmationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmationText: {
    flex: 1,
    lineHeight: 22,
  },
  errorBanner: {
    marginBottom: 16,
    borderWidth: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    lineHeight: 22,
  },
});
