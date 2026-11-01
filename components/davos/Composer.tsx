// components/davos/Composer.tsx
// Canonical component for Object: Thread (PRD §3, §8, §12; design/DESIGN.md §6).
// Props: value, onSend, onUrge
// States: enabled, disabled, offline
// Urge placement: strictly to the LEFT of the input; Send strictly to the RIGHT.
// Hairline divider, no cards, no elevation.
// Uses only theme/roles.ts.

import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

export interface ComposerProps {
  value: string;
  onChangeText?: (text: string) => void;
  onSend: (text: string) => void;
  onUrge: () => void;
  state?: 'enabled' | 'disabled' | 'offline';
  placeholder?: string;
  colorScheme?: 'light' | 'dark';
}

export function Composer({
  value,
  onChangeText,
  onSend,
  onUrge,
  state = 'enabled',
  placeholder = 'Message Davos',
  colorScheme = 'light',
}: ComposerProps) {
  const colors = colorRoles[colorScheme];
  const isDisabled = state === 'disabled';
  const isOffline = state === 'offline';
  const canSend = !isDisabled && value.trim().length > 0;

  const handleSendPress = () => {
    if (!canSend) return;
    onSend(value.trim());
  };

  const handleKeyPress = (e: any) => {
    // Web: Enter sends, Shift+Enter inserts a newline (PRD AU19, Behaviour Pass)
    if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter') {
      if (!e.nativeEvent.shiftKey) {
        e.preventDefault?.();
        handleSendPress();
      }
    }
  };

  return (
    <View style={[styles.container, { borderTopColor: colors.divider, backgroundColor: colors.surface }]}>
      {/* 1. Urge button strictly to the LEFT of the input (PRD §8) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report or resist an urge"
        disabled={isDisabled}
        hitSlop={touchTarget.hitSlop}
        style={({ focused }: any) => [
          styles.actionButton,
          focused && Platform.OS === 'web' ? { outlineColor: colors.focusRing, outlineWidth: 2, outlineStyle: 'solid' as any } : null,
        ]}
        onPress={onUrge}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.heading,
            { color: isDisabled ? colors.disabled : colors.accent },
          ]}
          allowFontScaling={true}>
          Urge
        </Text>
      </Pressable>

      {/* 2. Text input in the middle */}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.disabled}
        editable={!isDisabled}
        multiline={true}
        accessibilityLabel="Message Davos input"
        style={[
          styles.input,
          typeRoles.userText,
          {
            color: isDisabled ? colors.disabled : colors.textPrimary,
            borderColor: colors.divider,
          },
          Platform.OS === 'web' ? ({ outlineColor: colors.focusRing } as any) : null,
        ]}
        allowFontScaling={true}
        onKeyPress={handleKeyPress}
        onSubmitEditing={handleSendPress}
      />

      {/* 3. Send button strictly to the RIGHT of the input */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isOffline
            ? 'Queue message offline'
            : canSend
            ? 'Send message'
            : 'Send message disabled'
        }
        disabled={!canSend}
        hitSlop={touchTarget.hitSlop}
        style={({ focused }: any) => [
          styles.actionButton,
          focused && Platform.OS === 'web' ? { outlineColor: colors.focusRing, outlineWidth: 2, outlineStyle: 'solid' as any } : null,
        ]}
        onPress={handleSendPress}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.heading,
            { color: canSend ? colors.textPrimary : colors.disabled },
          ]}
          allowFontScaling={true}>
          {isOffline ? 'Queue' : 'Send'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
  input: {
    flex: 1,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
