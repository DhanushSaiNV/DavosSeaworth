// components/davos/UserMessage.tsx
// Canonical component for Object: Thread (PRD §3, §12; Blueprint §2.1, §2.2).
// Props: text, sendState, onRetry
// Left-aligned transcript: indent of sm (16), no right alignment flip, no bubbles.
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { LINE, META_LINE } from '../../theme/layout';
import { hapticImpactLight, hapticSelection } from '../../lib/haptics';

export interface UserMessageProps {
  text: string;
  time?: string;
  showTime?: boolean;
  sendState?: 'sent' | 'sending' | 'failed';
  onRetry?: () => void;
  colorScheme?: 'light' | 'dark';
  onUndo?: () => void;
  showUndo?: boolean;
}

export function UserMessage({
  text,
  time,
  sendState = 'sent',
  onRetry,
  colorScheme,
  onUndo,
  showUndo = false,
}: UserMessageProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`You said: ${text}${time ? ` at ${time}` : ''}`}
    >
      <View style={styles.contentRow}>
        {/* User line: left-aligned record at content x=72 (no indent), textPrimary 400 */}
        <Text
          style={[
            styles.messageText,
            typeRoles.userText,
            { color: colors.textPrimary, fontWeight: '400', lineHeight: LINE },
          ]}
          allowFontScaling={true}>
          {text}
        </Text>

        {/* Right-aligned meta Undo (44pt target) on the answer row, gone after 6s */}
        {showUndo && onUndo && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo"
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle, borderless: true }}
            style={({ pressed }) => [styles.undoButton, pressed && { opacity: 0.7 }]}
            onPress={() => {
              void hapticImpactLight();
              onUndo();
            }}>
            <Text
              style={[
                styles.undoText,
                typeRoles.meta,
                { color: colors.textSecondary, lineHeight: META_LINE },
              ]}
              allowFontScaling={true}>
              Undo
            </Text>
          </Pressable>
        )}
      </View>

      {/* Sending indicator */}
      {sendState === 'sending' && (
        <Text
          style={[styles.stateText, typeRoles.meta, { color: colors.textSecondary, lineHeight: META_LINE }]}
          allowFontScaling={true}>
          Sending...
        </Text>
      )}

      {/* Failure recovery */}
      {sendState === 'failed' && (
        <View style={styles.errorRow}>
          <Text
            style={[styles.errorText, typeRoles.meta, { color: colors.danger, lineHeight: META_LINE }]}
            allowFontScaling={true}>
            Not sent.
          </Text>
          {onRetry && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry sending message"
              hitSlop={touchTarget.hitSlop}
              android_ripple={{ color: colors.borderSubtle, borderless: true }}
              style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.7 }]}
              onPress={() => {
                void hapticSelection();
                onRetry();
              }}>
              <Text
                style={[styles.retryText, typeRoles.meta, { color: colors.danger, lineHeight: META_LINE }]}
                allowFontScaling={true}>
                Retry
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingLeft: 0, // No indent per brief
    marginTop: 0,
    alignItems: 'flex-start',
    width: '100%',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  messageText: {
    paddingHorizontal: spacing.none,
    textAlign: 'left',
    flex: 1,
  },
  undoButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
    borderWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  undoText: {
    paddingHorizontal: spacing.none,
  },
  stateText: {
    paddingTop: spacing.xxs,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xxs,
  },
  errorText: {
    paddingHorizontal: spacing.none,
  },
  retryButton: {
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  retryText: {
    paddingHorizontal: spacing.none,
    fontWeight: '600',
  },
});
