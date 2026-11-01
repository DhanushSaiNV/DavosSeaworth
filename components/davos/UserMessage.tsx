// components/davos/UserMessage.tsx
// Canonical component for Object: Thread (PRD §3, §12; design/DESIGN.md §6).
// Props: text, time, sendState
// States: sent, sending, failed
// Unboxed plain text (PRD §14 #1, #2: zero cards, zero bubbles).
// Uses only theme/roles.ts.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

export interface UserMessageProps {
  text: string;
  time: string;
  showTime?: boolean;
  sendState: 'sent' | 'sending' | 'failed';
  onRetry?: () => void;
  colorScheme?: 'light' | 'dark';
}

export function UserMessage({
  text,
  time,
  showTime = true,
  sendState,
  onRetry,
  colorScheme = 'light',
}: UserMessageProps) {
  const colors = colorRoles[colorScheme];

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`You said: ${text} at ${time}`}
    >
      {/* User unboxed message line: right-aligned, primary text colour, regular weight */}
      <Text
        style={[
          styles.messageText,
          typeRoles.userText,
          { color: colors.textPrimary, fontWeight: '400' },
        ]}
        allowFontScaling={true}>
        {text}
      </Text>

      {/* Meta status row: time, sending indicator, or failure recovery */}
      <View style={styles.metaRow}>
        {showTime && (
          <Text
            style={[styles.metaText, typeRoles.figure, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            {time}
          </Text>
        )}

        {sendState === 'sending' && (
          <Text
            style={[styles.stateText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Sending...
          </Text>
        )}

        {sendState === 'failed' && (
          <View style={styles.errorRow}>
            <Text
              style={[styles.errorText, typeRoles.meta, { color: colors.danger }]}
              allowFontScaling={true}>
              Not sent.
            </Text>
            {onRetry && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry sending message"
                hitSlop={touchTarget.hitSlop}
                style={styles.retryButton}
                onPress={onRetry}>
                <Text
                  style={[styles.retryText, typeRoles.meta, { color: colors.danger }]}
                  allowFontScaling={true}>
                  Retry
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    gap: spacing.xxs,
    maxWidth: '85%',
  },
  messageText: {
    paddingHorizontal: spacing.none,
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaText: {
    paddingHorizontal: spacing.none,
  },
  stateText: {
    paddingHorizontal: spacing.none,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  errorText: {
    paddingHorizontal: spacing.none,
  },
  retryButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  retryText: {
    paddingHorizontal: spacing.none,
    fontWeight: '600',
  },
});
