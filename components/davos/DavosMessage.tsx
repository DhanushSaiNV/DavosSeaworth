// components/davos/DavosMessage.tsx
// Canonical component for Object: Thread (PRD §3, §12; design/DESIGN.md §6).
// Props: text, time, ruleId?
// States: default, expanded "Why this?"
// Unboxed plain text (PRD §14 #1, #2: zero cards, zero bubbles, zero avatars).
// Uses only theme/roles.ts.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { tabularNums } from '../../theme/tokens/typography';

export interface DavosMessageProps {
  text: string;
  time: string;
  showTime?: boolean;
  ruleId?: string;
  colorScheme?: 'light' | 'dark';
  defaultExpanded?: boolean;
}

export function DavosMessage({
  text,
  time,
  showTime = true,
  ruleId,
  colorScheme,
  defaultExpanded = false,
}: DavosMessageProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  // PRD B.4: Prompt already starts with its time ("09:00. Plan says ..."): don't show second timestamp under it
  const startsWithTime = /^\d{1,2}:\d{2}\./.test(text.trim());
  const shouldShowTime = showTime && !startsWithTime;

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`Davos said: ${text} at ${time}`}
    >
      {/* Davos unboxed message line: left-aligned, regular weight (not bold), primary text colour */}
      <Text
        style={[
          styles.messageText,
          typeRoles.davosVoice,
          { color: colors.textPrimary, fontWeight: '400' },
        ]}
        allowFontScaling={true}>
        {text}
      </Text>

      {/* Footer row: optional time (only when minute differs and not already in prompt) and optional 'Why this?' tactic affordance */}
      {(shouldShowTime || ruleId) && (
        <View style={styles.metaRow}>
          {shouldShowTime && (
            <Text
              style={[styles.metaText, typeRoles.meta, tabularNums, { color: colors.textSecondary, fontWeight: '400' }]}
              allowFontScaling={true}>
              {time}
            </Text>
          )}

          {ruleId && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isExpanded
                  ? `Collapse tactic rule explanation for ${ruleId}`
                  : `Expand tactic rule explanation for ${ruleId}`
              }
              hitSlop={touchTarget.hitSlop}
              style={styles.whyThisButton}
              onPress={() => setIsExpanded((prev) => !prev)}>
              <Text
                style={[
                  styles.whyThisText,
                  typeRoles.meta,
                  { color: colors.textSecondary },
                ]}
                allowFontScaling={true}>
                {isExpanded ? 'Hide why this' : 'Why this?'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Expanded 'Why this?' state: rule detail */}
      {isExpanded && ruleId && (
        <View style={styles.expandedDetail}>
          <Text
            style={[styles.ruleText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Rule {ruleId}: Targeted behavioral tactic from Davos protocol.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    alignItems: 'flex-start',
    gap: spacing.xxs,
  },
  messageText: {
    paddingHorizontal: spacing.none,
    textAlign: 'left',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaText: {
    paddingHorizontal: spacing.none,
  },
  whyThisButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  whyThisText: {
    paddingHorizontal: spacing.none,
  },
  expandedDetail: {
    paddingTop: spacing.xxs,
    paddingBottom: spacing.xxs,
  },
  ruleText: {
    paddingHorizontal: spacing.none,
  },
});
