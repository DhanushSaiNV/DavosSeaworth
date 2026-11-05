// components/davos/UrgeBanner.tsx
// Sticky banner rendered immediately above the composer during an active urge hold.
// RN primitives only, tokens via useTheme.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';
import { typography } from '../../theme/tokens/typography';

export interface UrgeBannerProps {
  visible: boolean;
  title?: string;
  trigger: string;
  countdown: string;
  onOpen: () => void;
}

export function UrgeBanner({
  visible,
  title = 'Urge hold active',
  trigger,
  countdown,
  onOpen,
}: UrgeBannerProps) {
  const { colors } = useTheme();

  if (!visible) return null;

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: colors.border,
          backgroundColor: colors.surfaceSubtle,
        },
      ]}
      accessibilityLiveRegion="polite">
      <View
        style={[
          styles.diamondMark,
          {
            borderColor: colors.textSecondary,
          },
        ]}
      />
      <View style={styles.copy}>
        <Text
          style={[
            styles.title,
            typeRoles.meta,
            { color: colors.textPrimary, fontWeight: '600' },
          ]}
          allowFontScaling={true}>
          {title.toUpperCase()}
        </Text>
        <Text
          style={[
            styles.sub,
            typeRoles.meta,
            { color: colors.textSecondary },
          ]}
          numberOfLines={1}
          allowFontScaling={true}>
          {trigger || 'Stay with the current task'}
        </Text>
      </View>
      <Text
        style={[
          styles.countdown,
          typeRoles.figure,
          { color: colors.textPrimary, fontWeight: '600' },
        ]}
        allowFontScaling={true}>
        {countdown}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open urge hold details"
        hitSlop={touchTarget.hitSlop}
        style={styles.openButton}
        onPress={onOpen}>
        <Text
          style={[
            styles.openButtonText,
            typeRoles.meta,
            { color: colors.textSecondary },
          ]}
          allowFontScaling={true}>
          Open
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  diamondMark: {
    width: 8,
    height: 8,
    borderWidth: 1.5,
    transform: [{ rotate: '45deg' }],
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.6,
  },
  sub: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  countdown: {
    fontSize: 11,
    lineHeight: 14,
  },
  openButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  openButtonText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
