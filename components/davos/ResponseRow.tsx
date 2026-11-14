// components/davos/ResponseRow.tsx
// Canonical response strip for Check-in (Blueprint §2.4).
// A single ruled strip (hairline top and bottom, NO per-button borders or fills).
// Four equal-weight text commands (Did it, Partly, Didn't, Something else).
// Pressed and hover: surfaceSubtle fill.
// On web: 2px textPrimary focus ring and supports keys 1–4.
// RN primitives only.

import React, { useEffect } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { hapticSelection } from '../../lib/haptics';

export type CheckInResponseOption =
  | 'did_it'
  | 'partly'
  | 'didnt'
  | 'something_else'
  | 'held'
  | 'yielded'
  | string;

export interface ResponseOptionItem {
  key: CheckInResponseOption;
  label: string;
}

export interface ResponseRowProps {
  options?: ResponseOptionItem[];
  onSelect: (option: CheckInResponseOption) => void;
  selectedOption?: CheckInResponseOption | null;
  disabled?: boolean;
  groupAccessibilityLabel?: string;
  colorScheme?: 'light' | 'dark';
}

export const DEFAULT_CHECKIN_OPTIONS: ResponseOptionItem[] = [
  { key: 'did_it', label: 'Did it' },
  { key: 'partly', label: 'Partly' },
  { key: 'didnt', label: "Didn't" },
  { key: 'something_else', label: 'Something else' },
];

export const URGE_OPTIONS: ResponseOptionItem[] = [
  { key: 'held', label: 'Held' },
  { key: 'yielded', label: 'Gave in' },
];

export function ResponseRow({
  options = DEFAULT_CHECKIN_OPTIONS,
  onSelect,
  selectedOption = null,
  disabled = false,
  groupAccessibilityLabel = 'Response options',
  colorScheme,
}: ResponseRowProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  // Web keyboard support: keys 1..4 trigger the corresponding option (Blueprint §2.4)
  useEffect(() => {
    if (disabled || Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= options.length) {
        e.preventDefault();
        onSelect(options[num - 1].key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, options, onSelect]);

  return (
    <View
      style={[
        styles.ruledStrip,
        {
          borderTopColor: colors.divider,
          borderBottomColor: colors.divider,
        },
      ]}
      accessible={true}
      accessibilityRole="radiogroup"
      accessibilityLabel={groupAccessibilityLabel}>
      {options.map((opt) => {
        const isSelected = selectedOption === opt.key;

        return (
          <Pressable
            key={opt.key}
            accessibilityRole="button"
            accessibilityLabel={`${opt.label}${isSelected ? ', selected' : ''}`}
            accessibilityState={{ selected: isSelected }}
            disabled={disabled}
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle }}
            style={({ pressed, hovered, focused }: any) => [
              styles.optionCommand,
              {
                backgroundColor:
                  pressed || hovered || isSelected
                    ? colors.surfaceSubtle
                    : 'transparent',
              },
              focused && Platform.OS === 'web'
                ? ({
                    outlineColor: colors.textPrimary,
                    outlineWidth: 2,
                    outlineStyle: 'solid',
                  } as any)
                : null,
            ]}
            onPress={() => {
              void hapticSelection();
              onSelect(opt.key);
            }}>
            <Text
              style={[
                styles.optionLabel,
                typeRoles.davosVoice,
                {
                  color: disabled ? colors.disabled : colors.textPrimary,
                  fontWeight: '500',
                },
              ]}
              allowFontScaling={true}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  ruledStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    marginVertical: spacing.xxs,
  },
  optionCommand: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionLabel: {
    paddingHorizontal: spacing.none,
  },
});
