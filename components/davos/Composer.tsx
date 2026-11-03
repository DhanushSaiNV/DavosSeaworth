// components/davos/Composer.tsx
// Canonical component for Object: Thread (PRD §3, §8, §12; design/DESIGN.md §6).
// Props: value, onSend, onUrge
// States: enabled, disabled, offline
// Urge placement: strictly to the LEFT of the input; Send strictly to the RIGHT.
// Hairline divider, no cards, no elevation.
// Uses theme hook (PRD Step 0, A.2, AU37). Control borders >= 3:1 on surface (A.6, B.6).

import React, { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
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
  colorScheme,
  inputRef,
}: ComposerProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const isDisabled = state === 'disabled';
  const isOffline = state === 'offline';
  const canSend = !isDisabled && value.trim().length > 0;
  const [inputHeight, setInputHeight] = useState<number>(44);
  const [isFocused, setIsFocused] = useState<boolean>(false);

  useEffect(() => {
    if (!value || value.trim().length === 0) {
      setInputHeight(44);
    }
  }, [value]);

  const handleContentSizeChange = (e: any) => {
    const rawHeight = e.nativeEvent?.contentSize?.height;
    if (rawHeight) {
      // Single-line 44px growing up to ~112px max (4 lines at 22px line-height + 20px padding)
      const clamped = Math.max(44, Math.min(112, Math.ceil(rawHeight)));
      setInputHeight(clamped);
    }
  };

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

  const canvasBg = theme.isDark ? colors.background : colors.surface;

  return (
    <View style={[styles.container, { borderTopColor: colors.divider, backgroundColor: canvasBg }]}>
      {/* 1. Urge button strictly to the LEFT of the input (PRD §8, A8, body medium label) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report or resist an urge"
        disabled={isDisabled}
        hitSlop={touchTarget.hitSlop}
        style={({ focused, pressed }: any) => [
          styles.urgeButton,
          {
            borderColor: focused ? colors.focusRing : colors.controlBorder,
            backgroundColor: canvasBg,
            opacity: pressed ? 0.7 : 1,
          },
          focused && Platform.OS === 'web' ? { outlineColor: colors.focusRing, outlineWidth: 2, outlineStyle: 'solid' as any } : null,
        ]}
        onPress={onUrge}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.davosVoice,
            { color: isDisabled ? colors.disabled : colors.textPrimary, fontWeight: '500' },
          ]}
          allowFontScaling={true}>
          Urge
        </Text>
      </Pressable>

      {/* 2. Text input in the middle (single-line height 44-48px growing to max 4 lines, vertically centred placeholder) */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={handleContentSizeChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
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
            height: inputHeight,
            color: isDisabled ? colors.disabled : colors.textPrimary,
            borderColor: isFocused ? colors.focusRing : colors.controlBorder,
            backgroundColor: canvasBg,
          },
          Platform.OS === 'web' ? ({ outlineColor: colors.focusRing } as any) : null,
        ]}
        allowFontScaling={true}
        onKeyPress={handleKeyPress}
        onSubmitEditing={handleSendPress}
      />

      {/* 3. Send button strictly to the RIGHT of the input (body medium label) */}
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
        style={({ focused, pressed }: any) => [
          styles.sendButton,
          canSend
            ? {
                borderColor: focused ? colors.focusRing : colors.controlBorder,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: radius.sm,
                backgroundColor: canvasBg,
                opacity: pressed ? 0.7 : 1,
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
            typeRoles.davosVoice,
            {
              color: canSend ? colors.textPrimary : colors.disabled,
              fontWeight: '500',
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
    alignItems: 'flex-end',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sendButton: {
    height: 44,
    minHeight: 44,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  urgeButton: {
    height: 44,
    minHeight: 44,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
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
    minHeight: 44,
    maxHeight: 112, // ~4 lines at 22px line-height + 20px vertical padding
    paddingHorizontal: spacing.xs,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
});
