// components/davos/Composer.tsx
// Canonical component for Object: Thread composer (Redesign Mockup).
// Layout: Caption row (CONVERSATION / ENTER TO SEND) + Urge button + Input wrap with Send.
// RN primitives only. Tokens via useTheme.

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
import { typography } from '../../theme/tokens/typography';

export interface ComposerProps {
  value: string;
  onChangeText?: (text: string) => void;
  onSend: (text: string) => void;
  onUrge: () => void;
  state?: 'enabled' | 'disabled' | 'offline';
  placeholder?: string;
  colorScheme?: 'light' | 'dark';
  inputRef?: React.RefObject<TextInput | null>;
  isUrgeActive?: boolean;
  urgeLabel?: string;
}

export function Composer({
  value,
  onChangeText,
  onSend,
  onUrge,
  state = 'enabled',
  placeholder = 'Talk to Davos…',
  colorScheme,
  inputRef,
  isUrgeActive = false,
  urgeLabel,
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
      const clamped = Math.max(44, Math.min(112, Math.ceil(rawHeight)));
      setInputHeight(clamped);
    }
  };

  const handleSendPress = () => {
    if (!canSend) return;
    onSend(value.trim());
  };

  const handleKeyPress = (e: any) => {
    if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter') {
      if (!e.nativeEvent.shiftKey) {
        e.preventDefault?.();
        handleSendPress();
      }
    }
  };

  const displayUrgeText =
    urgeLabel || (isUrgeActive ? 'Urge active' : 'Log urge');

  return (
    <View
      style={[
        styles.wrapper,
        {
          borderTopColor: colors.borderSubtle,
          backgroundColor: canvasBg,
        },
      ]}>
      <View style={styles.composerRow}>
        {/* Urge button: 44pt, diamond mark + text */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report or resist an urge"
          disabled={isDisabled}
          hitSlop={touchTarget.hitSlop}
          style={({ pressed }: any) => [
            styles.urgeButton,
            {
              backgroundColor: isUrgeActive ? colors.accentSubtle : colors.surface,
              borderColor: isUrgeActive ? colors.borderFocus : colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          onPress={onUrge}>
          <View
            style={[
              styles.diamond,
              {
                borderColor: isUrgeActive ? colors.accent : colors.textSecondary,
              },
            ]}
          />
          <Text
            style={[
              styles.urgeButtonText,
              typeRoles.davosVoice,
              {
                color: isUrgeActive
                  ? colors.accent
                  : isDisabled
                  ? colors.disabled
                  : colors.textSecondary,
                fontWeight: '500',
              },
            ]}
            allowFontScaling={true}>
            {displayUrgeText}
          </Text>
        </Pressable>

        {/* Input Wrapper */}
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: colors.surface,
              borderColor: isFocused ? colors.borderFocus : colors.border,
            },
          ]}>
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
                color: isDisabled ? colors.disabled : colors.textPrimary,
              },
              Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
            ]}
            allowFontScaling={true}
            onKeyPress={handleKeyPress}
            onSubmitEditing={handleSendPress}
          />

          {canSend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isOffline ? 'Queue message' : 'Send message'}
              hitSlop={touchTarget.hitSlop}
              style={({ pressed }: any) => [
                styles.sendButton,
                {
                  backgroundColor: colors.surfaceRaised,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              onPress={handleSendPress}>
              <Text
                style={[
                  styles.sendButtonText,
                  typeRoles.davosVoice,
                  { color: colors.textPrimary, fontWeight: '500' },
                ]}
                allowFontScaling={true}>
                →
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  urgeButton: {
    height: 44,
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  diamond: {
    width: 8,
    height: 8,
    borderWidth: 1.5,
    transform: [{ rotate: '45deg' }],
  },
  urgeButtonText: {
    fontSize: 10,
    letterSpacing: 0.4,
  },
  inputWrap: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingLeft: 12,
    paddingRight: 6,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 112,
    paddingVertical: 10,
    fontSize: 13,
  },
  sendButton: {
    width: 32,
    height: 32,
    minHeight: 32,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: {
    fontSize: 14,
    lineHeight: 16,
  },
});
