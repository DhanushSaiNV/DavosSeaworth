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
  radius,
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
  inputRef?: React.RefObject<TextInput | null>;
}

export function Composer({
  value,
  onChangeText,
  onSend,
  onUrge,
  state = 'enabled',
  placeholder = 'Message Davos',
  colorScheme = 'light',
  inputRef,
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
      {/* 1. Urge button strictly to the LEFT of the input (PRD §8, A8) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report or resist an urge"
        disabled={isDisabled}
        hitSlop={touchTarget.hitSlop}
        style={({ focused }: any) => [
          styles.urgeButton,
          {
            borderColor: colors.divider,
            backgroundColor: colors.surface,
          },
          focused && Platform.OS === 'web' ? { outlineColor: colors.focusRing, outlineWidth: 2, outlineStyle: 'solid' as any } : null,
        ]}
        onPress={onUrge}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.userText,
            { color: isDisabled ? colors.disabled : colors.textPrimary, fontWeight: '400' },
          ]}
          allowFontScaling={true}>
          Urge
        </Text>
      </Pressable>

      {/* 2. Text input in the middle (vertically centered placeholder) */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.disabled}
        editable={!isDisabled}
        multiline={true}
        textAlignVertical="center"
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
          styles.sendButton,
          canSend
            ? {
                borderColor: colors.divider,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: radius.sm,
                backgroundColor: colors.surface,
              }
            : {
                borderColor: 'transparent',
                borderWidth: StyleSheet.hairlineWidth,
              },
          focused && Platform.OS === 'web' ? { outlineColor: colors.focusRing, outlineWidth: 2, outlineStyle: 'solid' as any } : null,
        ]}
        onPress={handleSendPress}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.userText,
            {
              color: canSend ? colors.textPrimary : colors.disabled,
              fontWeight: '400',
            },
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
  sendButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  urgeButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
  input: {
    flex: 1,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
});
