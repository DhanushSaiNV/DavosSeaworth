// components/davos/CatchupStrip.tsx
// Quiet, non-intrusive strip alerting the user to past unlogged periods from today.
// RN primitives only (View, Text, Pressable, ScrollView). Tokens via useTheme.

import React from 'react';
import {
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, touchTarget, typeRoles } from '../../theme/roles';
import { hapticImpactLight, hapticSelection } from '../../lib/haptics';
import type { MissedCheckinWindow } from '../../lib/checkinUi';

export interface CatchupStripProps {
  missedWindows: MissedCheckinWindow[];
  activeWindowTime?: string | null;
  onSelectWindow: (win: MissedCheckinWindow) => void;
  onDismiss: () => void;
}

export function CatchupStrip({
  missedWindows,
  activeWindowTime,
  onSelectWindow,
  onDismiss,
}: CatchupStripProps) {
  const { colors } = useTheme();

  if (missedWindows.length === 0) return null;

  const count = missedWindows.length;
  const labelText =
    count === 1
      ? '1 unlogged period today:'
      : `${count} unlogged periods today:`;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceSubtle,
          borderTopColor: colors.borderSubtle,
          borderBottomColor: colors.borderSubtle,
        },
      ]}
      accessibilityLabel={`Catch up on missed check-ins, ${count} unlogged`}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Text
            style={[styles.clockIcon, typeRoles.meta, { color: colors.warning }]}
            allowFontScaling={true}>
            🕒
          </Text>
          <Text
            style={[
              styles.label,
              typeRoles.meta,
              { color: colors.textSecondary, fontWeight: '600' },
            ]}
            allowFontScaling={true}>
            {labelText}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss unlogged periods catch up"
          hitSlop={touchTarget.hitSlop}
          android_ripple={{ color: colors.borderSubtle, borderless: true }}
          style={styles.dismissBtn}
          onPress={() => {
            void hapticImpactLight();
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            onDismiss();
          }}>
          <Text
            style={[styles.dismissText, typeRoles.meta, { color: colors.textTertiary }]}
            allowFontScaling={true}>
            ✕
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal={true}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScroll}
        keyboardShouldPersistTaps="handled">
        {missedWindows.map((item) => {
          const isSelected = activeWindowTime === item.windowTime;
          return (
            <Pressable
              key={item.windowTime}
              accessibilityRole="button"
              accessibilityLabel={`Log missed period ${item.windowTime}`}
              accessibilityState={{ selected: isSelected }}
              hitSlop={touchTarget.hitSlop}
              android_ripple={{ color: colors.borderSubtle }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: isSelected
                    ? colors.surface
                    : colors.surfaceRaised,
                  borderColor: isSelected ? colors.warning : colors.border,
                },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => {
                void hapticSelection();
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                onSelectWindow(item);
              }}>
              <Text
                style={[
                  styles.chipText,
                  typeRoles.figure,
                  {
                    color: isSelected ? colors.textPrimary : colors.textSecondary,
                    fontWeight: isSelected ? '700' : '500',
                  },
                ]}
                allowFontScaling={true}>
                {item.windowTime}
              </Text>
              <Text
                style={[
                  styles.chipAction,
                  typeRoles.meta,
                  {
                    color: isSelected ? colors.warningText : colors.accent,
                    marginLeft: spacing.xxs,
                  },
                ]}
                allowFontScaling={true}>
                {isSelected ? 'Logging…' : 'Log'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xxs,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clockIcon: {
    fontSize: 12,
    marginRight: spacing.xxs,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  dismissBtn: {
    padding: spacing.xxs,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 12,
    fontWeight: '700',
  },
  chipsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    marginRight: spacing.xs,
    minHeight: 44,
  },
  chipText: {
    fontSize: 12,
  },
  chipAction: {
    fontSize: 11,
    fontWeight: '600',
  },
});
