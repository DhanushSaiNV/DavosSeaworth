import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { splitBlocks, stripSummary, type Block } from '../../lib/journal/strip';

// BG-10 Steps 2–3 — distraction-free journal editor with block-level
// Unsavable flags + post-strip preview. Local only: the draft is persisted
// in AsyncStorage; NOTHING is transmitted (submit-journal does not exist yet
// and is NOT invented here). Flagged blocks are stripped client-side by the
// pure stripUnsavable before any future transmission (D3, TECH-SPECS §7.4).
//
// Flag keying is by exact block text (owner decision): it survives edits
// ABOVE a block; a flagged block whose text is edited detaches.

const DRAFT_KEY = 'davos_journal_draft';
const REPARSE_DEBOUNCE_MS = 300;
const SAVE_DEBOUNCE_MS = 500;

interface Draft {
  raw: string;
  flaggedTexts: string[];
  updatedAt: string;
}

export default function JournalScreen() {
  // The screen renders with no header, so the title needs the status-bar inset or it
  // starts underneath the notch / edge-to-edge status bar.
  const insets = useSafeAreaInsets();
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

  // Post-strip preview (Step 3): the SAME pure function the unit tests pin —
  // what you see here is byte-for-byte what any future transmission sends.
  const summary = useMemo(() => stripSummary(raw, flaggedSet), [raw, flaggedSet]);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Journal</Text>
      <Text style={styles.hint}>
        Write freely. Flag any block Unsavable and it will never leave this device.
      </Text>
      <TextInput
        style={styles.editor}
        multiline
        textAlignVertical="top"
        placeholder="Brain dump — no structure needed."
        value={raw}
        onChangeText={setRaw}
      />

      {blocks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blocks — tap to flag Unsavable</Text>
          {blocks.map((b) => {
            const flagged = flaggedSet.has(b.text);
            return (
              <TouchableOpacity
                key={`${b.start}:${b.end}`}
                style={[styles.block, flagged && styles.blockFlagged]}
                onPress={() => toggleBlock(b.text)}
                accessibilityRole="button"
                accessibilityState={{ selected: flagged }}
              >
                <Text style={[styles.blockText, flagged && styles.blockTextFlagged]}>{b.text}</Text>
                <Text style={[styles.blockFlag, flagged && styles.blockFlaggedLabel]}>
                  {/* The lock carries the "never leaves this device" promise as a shape,
                      not just a red tint (colour-blind safe). */}
                  {flagged ? '🔒 UNSAVABLE' : 'save'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        style={styles.previewToggle}
        onPress={() => setShowPreview((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`${summary.sent} of ${summary.total} blocks would be sent`}
      >
        <Text style={styles.previewToggleText}>
          {showPreview ? 'Hide' : 'Preview'} what Davos receives
        </Text>
        {/* The count rides with the toggle as a pill instead of a parenthetical; red only
            when nothing would be sent, with the number still carrying the meaning. */}
        <View
          style={[
            styles.countPill,
            summary.total > 0 && summary.sent === 0 && styles.countPillEmpty,
          ]}>
          <Text
            style={[
              styles.countPillText,
              summary.total > 0 && summary.sent === 0 && styles.countPillTextEmpty,
            ]}>
            {summary.sent}/{summary.total}
          </Text>
        </View>
      </TouchableOpacity>
      {showPreview && (
        <View style={styles.previewBox}>
          {summary.stripped === '' ? (
            <Text style={styles.previewEmpty}>(nothing would be sent — all blocks flagged)</Text>
          ) : (
            <Text style={styles.previewText}>{summary.stripped}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
  },
  editor: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: '#111',
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  block: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  blockFlagged: {
    borderColor: '#b00',
    backgroundColor: '#fff5f5',
  },
  blockText: {
    flex: 1,
    fontSize: 14,
    color: '#222',
  },
  blockTextFlagged: {
    textDecorationLine: 'line-through',
    color: '#888',
  },
  blockFlag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
  },
  /** The flagged state must be legible at a glance: the label takes the danger tone. */
  blockFlaggedLabel: {
    color: '#b00',
  },
  previewToggle: {
    marginTop: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  countPill: {
    backgroundColor: '#e8f1fa',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#185fa5',
    fontVariant: ['tabular-nums'],
  },
  countPillEmpty: {
    backgroundColor: '#fdecea',
  },
  countPillTextEmpty: {
    color: '#c0392b',
  },
  previewToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#185fa5',
  },
  previewBox: {
    borderWidth: 1,
    borderColor: '#185fa5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 32,
    backgroundColor: '#f4f8fc',
  },
  previewText: {
    fontSize: 14,
    color: '#111',
  },
  previewEmpty: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#666',
  },
});
