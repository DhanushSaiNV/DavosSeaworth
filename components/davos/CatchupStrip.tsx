// components/davos/CatchupStrip.tsx
// Quiet, typographic strip alerting the user to past unlogged periods from today.
// RN primitives only (View, Text, Pressable, ScrollView). Tokens via useTheme.
// Tone: Direct, steady, fair. No emoji (PRD §14, §12). Minimum 44dp touch targets.

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
      ? 'MISSED CHECK-IN'
      : `UNLOGGED PERIODS · ${count}`;

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
      accessibilityLabel={`Catch up on missed check-ins, ${count} unlogged periods`}>
      <View style={styles.barInner}>
        {/* Left Indicator & Typographic Kicker */}
        <View style={styles.kickerGroup}>
          <View
            style={[
              styles.statusGlyph,
              {
                borderColor: colors.warning,
                backgroundColor: colors.surface,
              },
            ]}
          />
          <Text
            style={[
              styles.kickerText,
              typeRoles.meta,
              { color: colors.warningText, fontWeight: '700' },
            ]}
            allowFontScaling={true}>
            {labelText}
          </Text>
        </View>

        {/* Scrollable Chip Strip */}
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
                accessibilityLabel={`Log report for missed period ${item.windowTime}`}
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
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => {
                  void hapticSelection();
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  onSelectWindow(item);
                }}>
                <Text
                  style={[
                    styles.chipTime,
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
                    styles.chipDot,
                    typeRoles.meta,
                    { color: colors.textTertiary },
                  ]}
                  allowFontScaling={true}>
                  ·
                </Text>
                <Text
                  style={[
                    styles.chipAction,
                    typeRoles.meta,
                    {
                      color: isSelected ? colors.warningText : colors.accent,
                    },
                  ]}
                  allowFontScaling={true}>
                  {isSelected ? 'Logging…' : 'Log'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Dismiss Touch Target (min 44x44) */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  barInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  kickerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  statusGlyph: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
    marginRight: 6,
  },
  kickerText: {
    fontSize: 9,
    letterSpacing: 0.6,
  },
  chipsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 36,
  },
  chipTime: {
    fontSize: 11,
    lineHeight: 14,
  },
  chipDot: {
    marginHorizontal: 4,
    fontSize: 11,
    lineHeight: 14,
  },
  chipAction: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  dismissBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  dismissText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
