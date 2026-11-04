// components/davos/Composer.tsx
// Canonical component for Object: Thread composer (Blueprint §2.2, §2.5).
// Layout: Urge occupies x0–72, input starts at x=72, Send at right edge.
// Input has surfaceSubtle fill, radius sm, no border; focused adds 1px textSecondary border.
// Everything center-aligned on one row, min 44. RN primitives only.

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
import { StatusGlyph } from '../StatusGlyph';

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
  const isDark = colorScheme ? colorScheme === 'dark' : theme.isDark;
  const canvasBg = isDark ? colors.background : colors.surface;

  const isDisabled = state === 'disabled';
  const isOffline = state === 'offline';
  const hasText = value.trim().length > 0;
  const canSend = !isDisabled && hasText;

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
      // 44px growing up to ~112px max (~4 lines at 22px line-height + padding)
      const clamped = Math.max(44, Math.min(112, Math.ceil(rawHeight)));
      setInputHeight(clamped);
    }
  };

  const handleSendPress = () => {
    if (!canSend) return;
    onSend(value.trim());
  };

  const handleKeyPress = (e: any) => {
    // Web: Enter sends, Shift+Enter inserts a newline
    if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter') {
      if (!e.nativeEvent.shiftKey) {
        e.preventDefault?.();
        handleSendPress();
      }
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          borderTopColor: colors.divider,
          backgroundColor: canvasBg,
        },
      ]}>
      {/* 1. Urge: occupies x0–72, 44pt high, NO border, leading 8px diamond glyph */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report or resist an urge"
        disabled={isDisabled}
        hitSlop={touchTarget.hitSlop}
        style={({ pressed, focused }: any) => [
          styles.urgeButton,
          {
            opacity: pressed ? 0.7 : 1,
          },
          focused && Platform.OS === 'web'
            ? ({
                outlineColor: colors.textPrimary,
                outlineWidth: 2,
                outlineStyle: 'solid',
              } as any)
            : null,
        ]}
        onPress={onUrge}>
        <StatusGlyph state="urge_held" size={12} colorScheme={colorScheme} />
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

      {/* 2. Composer input: starts at x=72, surfaceSubtle fill, radius sm, no border; focused adds 1px textSecondary border */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={handleContentSizeChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        editable={!isDisabled}
        multiline={true}
        textAlignVertical="center"
        accessibilityLabel="Message Davos input"
        style={[
          styles.input,
          typeRoles.userText,
          {
            height: inputHeight,
            minHeight: 44,
            maxHeight: 112,
            backgroundColor: colors.surfaceSubtle,
            borderRadius: radius.sm,
            borderWidth: isFocused ? 1 : 0,
            borderColor: colors.textSecondary,
            color: isDisabled ? colors.disabled : colors.textPrimary,
          },
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
        ]}
        allowFontScaling={true}
        onKeyPress={handleKeyPress}
        onSubmitEditing={handleSendPress}
      />

      {/* 3. Text-only Send button at right edge, rendered ONLY when non-empty */}
      {canSend ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isOffline ? 'Queue message' : 'Send message'}
          hitSlop={touchTarget.hitSlop}
          style={({ pressed, focused }: any) => [
            styles.sendButton,
            {
              opacity: pressed ? 0.7 : 1,
            },
            focused && Platform.OS === 'web'
              ? ({
                  outlineColor: colors.textPrimary,
                  outlineWidth: 2,
                  outlineStyle: 'solid',
                } as any)
              : null,
          ]}
          onPress={handleSendPress}>
          <Text
            style={[
              styles.buttonText,
              typeRoles.davosVoice,
              { color: colors.textPrimary, fontWeight: '500' },
            ]}
            allowFontScaling={true}>
            {isOffline ? 'Queue' : 'Send'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
    paddingRight: 0,
  },
  urgeButton: {
    width: 72, // occupies x0–72
    height: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 0,
  },
  input: {
    flex: 1, // starts at x=72
    minHeight: 44,
    maxHeight: 112,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  sendButton: {
    height: 44,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
});
