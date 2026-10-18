import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { splitBlocks, stripSummary, type Block } from '../../lib/journal/strip';
import { useTheme } from '../../theme';
import { Screen, Card, Text, Icon, Badge } from '../../components/ui';

// BG-10 Steps 2–3 — distraction-free journal editor with block-level
// Unsavable flags + post-strip preview. Local only: the draft is persisted
// in AsyncStorage; NOTHING is transmitted. Flagged blocks are stripped client-side by the
// pure stripUnsavable before any future transmission (D3, TECH-SPECS §7.4).

const DRAFT_KEY = 'davos_journal_draft';
const REPARSE_DEBOUNCE_MS = 300;
const SAVE_DEBOUNCE_MS = 500;

interface Draft {
  raw: string;
  flaggedTexts: string[];
  updatedAt: string;
}

export default function JournalScreen() {
  const { colors, spacing, radius } = useTheme();
  const [raw, setRaw] = useState('');
  const [flaggedTexts, setFlaggedTexts] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const rawRef = useRef(raw);
  const flaggedRef = useRef(flaggedTexts);
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
      };
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [raw, flaggedTexts, loaded]);

  // Flush the draft on unmount.
  useEffect(() => {
    return () => {
      const draft: Draft = {
        raw: rawRef.current,
        flaggedTexts: flaggedRef.current,
        updatedAt: new Date().toISOString(),
      };
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
    };
  }, []);

  // Re-parse blocks (debounced) while typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setBlocks(splitBlocks(rawRef.current));
    }, REPARSE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [raw]);

  const flaggedSet = useMemo(() => new Set(flaggedTexts), [flaggedTexts]);

  const toggleBlock = useCallback((text: string) => {
    setFlaggedTexts((prev) =>
      prev.includes(text) ? prev.filter((t) => t !== text) : [...prev, text],
    );
  }, []);

  const summary = useMemo(() => stripSummary(raw, flaggedSet), [raw, flaggedSet]);

  return (
    <Screen scrollable maxWidth={640} contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text role="display" style={styles.title}>
            Journal
          </Text>
          <Text role="body" variant="secondary" style={styles.hint}>
            Write freely. Flag any block Unsavable and it will never leave this device.
          </Text>
        </View>
        <Badge
          label={flaggedTexts.length > 0 ? `${flaggedTexts.length} Unsavable` : 'Private'}
          variant={flaggedTexts.length > 0 ? 'danger' : 'neutral'}
          dot
        />
      </View>

      {/* Editor Box */}
      <Card elevation="raised" padding={spacing.md} style={styles.editorCard}>
        <TextInput
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
          onChangeText={setRaw}
          accessibilityLabel="Journal content editor"
        />
      </Card>

      {/* Block-level privacy breakdown */}
      {blocks.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text role="title" style={styles.sectionTitle}>
              Blocks
            </Text>
            <Text role="caption" variant="secondary">
              Tap any block to toggle its Unsavable flag
            </Text>
          </View>

          {blocks.map((b) => {
            const flagged = flaggedSet.has(b.text);
            return (
              <TouchableOpacity
                key={`${b.start}:${b.end}`}
                style={[
                  styles.block,
                  {
                    backgroundColor: flagged ? colors.dangerSurface : colors.surface,
                    borderColor: flagged ? colors.danger : colors.border,
                    borderRadius: radius.md,
                  },
                ]}
                onPress={() => toggleBlock(b.text)}
                accessibilityRole="button"
                accessibilityState={{ selected: flagged }}
                accessibilityLabel={flagged ? 'Flagged unsavable' : 'Will be saved'}
                activeOpacity={0.8}
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
                      <Icon name="lock" size="xs" color={colors.dangerText} />
                      <Text role="caption" variant="danger" style={styles.flaggedText}>
                        UNSAVABLE
                      </Text>
                    </View>
                  ) : (
                    <Text role="caption" variant="tertiary" style={styles.saveLabel}>
                      Save
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Post-strip Preview Section */}
      <View style={styles.previewContainer}>
        <TouchableOpacity
          style={styles.previewToggle}
          onPress={() => setShowPreview((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`${summary.sent} of ${summary.total} blocks would be sent`}
          activeOpacity={0.7}
        >
          <View style={styles.toggleLeft}>
            <Icon
              name={showPreview ? 'chevron-up' : 'chevron-down'}
              size="sm"
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
        </TouchableOpacity>

        {showPreview && (
          <Card
            elevation="none"
            padding={spacing.md}
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
                (Nothing would be sent — all blocks flagged as Unsavable)
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
  title: {
    marginBottom: 4,
  },
  hint: {
    maxWidth: 420,
    lineHeight: 20,
  },
  editorCard: {
    marginBottom: 24,
  },
  editor: {
    minHeight: 200,
    fontSize: 16,
    lineHeight: 24,
    padding: 4,
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
    letterSpacing: 0.5,
  },
  saveLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewContainer: {
    marginTop: 8,
  },
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
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
});
