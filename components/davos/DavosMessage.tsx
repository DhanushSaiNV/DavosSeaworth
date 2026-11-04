// components/davos/DavosMessage.tsx
// Canonical component for Object: Thread (PRD §3, §12; Blueprint §2.2).
// Props: text, tone?: 'live' | 'resolved', ruleId?, action?
// Unboxed plain text (zero cards, zero bubbles, zero avatars).
// Uses only theme/roles.ts. RN primitives only.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

export interface DavosMessageAction {
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export interface DavosMessageProps {
  text: string;
  time?: string;
  showTime?: boolean;
  tone?: 'live' | 'resolved';
  ruleId?: string;
  colorScheme?: 'light' | 'dark';
  defaultExpanded?: boolean;
  action?: DavosMessageAction;
}

export function DavosMessage({
  text,
  time,
  tone = 'resolved',
  ruleId,
  colorScheme,
  defaultExpanded = false,
  action,
}: DavosMessageProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  const isLive = tone === 'live';
  const textColor = isLive ? colors.textPrimary : colors.textSecondary;

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`Davos said: ${text}${time ? ` at ${time}` : ''}`}
    >
      {/* Davos voice: 15/22/500, textPrimary when live, textSecondary when resolved */}
      <Text
        style={[
          styles.messageText,
          typeRoles.davosVoice,
          { color: textColor, fontWeight: '500' },
        ]}
        allowFontScaling={true}>
        {text}
      </Text>

      {/* Optional action button (e.g. [Start] for evening session or [Draft an Oath]) */}
      {action && (
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            hitSlop={touchTarget.hitSlop}
            style={[styles.actionButton, { borderColor: colors.divider }]}
            onPress={action.onPress}>
            <Text
              style={[
                styles.actionButtonText,
                typeRoles.davosVoice,
                { color: colors.textPrimary, fontWeight: '500' },
              ]}
              allowFontScaling={true}>
              {action.label}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Optional 'Why this?' tactic affordance */}
      {ruleId && (
        <View style={styles.metaRow}>
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
    paddingVertical: 0,
    alignItems: 'flex-start',
    width: '100%',
  },
  messageText: {
    paddingHorizontal: spacing.none,
    textAlign: 'left',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxs,
  },
  whyThisButton: {
    minHeight: touchTarget.minTargetIos,
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
  actionRow: {
    paddingTop: spacing.xs,
    alignItems: 'flex-start',
  },
  actionButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
  },
  actionButtonText: {
    paddingHorizontal: spacing.none,
  },
});
