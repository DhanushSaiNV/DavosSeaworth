// components/ui/Input.tsx
// Unified Form Input primitive with focus states, error handling, and high contrast

import React, { useState } from 'react';
import {
  View,
  TextInput,
  TextInputProps,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Platform,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
}

export const Input = React.forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    hint,
    error,
    leftIcon,
    rightIcon,
    containerStyle,
    inputStyle,
    editable = true,
    style,
    onFocus,
    onBlur,
    ...rest
  },
  ref
) {
  const { colors, radius, spacing } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const hasError = Boolean(error);
  const isDisabled = !editable;

  const borderColor = hasError
    ? colors.danger
    : isFocused
    ? colors.borderFocus
    : colors.border;

  const backgroundColor = isDisabled
    ? colors.surfaceSubtle
    : colors.surface;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text role="caption" variant="secondary" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputWrapper,
          {
            borderColor,
            backgroundColor,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
          },
          isDisabled && styles.disabled,
          style as ViewStyle,
        ]}
      >
        {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}

        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.textInput,
            {
              color: colors.textPrimary,
            },
            inputStyle,
          ]}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />

        {rightIcon ? <View style={styles.rightIcon}>{rightIcon}</View> : null}
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <View style={[styles.errorDot, { backgroundColor: colors.danger }]} />
          <Text role="caption" variant="danger" style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text role="caption" variant="tertiary" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 50,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  leftIcon: {
    marginRight: 10,
  },
  rightIcon: {
    marginLeft: 10,
  },
  disabled: {
    opacity: 0.6,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  errorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  errorText: {
    flex: 1,
  },
  hint: {
    marginTop: 6,
  },
});
