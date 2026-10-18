// components/ui/TextField.tsx
// Core Form Text Input primitive with focus states, error handling, status icons, and high contrast.
// States: default, focused, disabled, error.

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
import { Icon } from './Icon';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
}

export const TextField = React.forwardRef<TextInput, TextFieldProps>(function TextField(
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
    accessibilityLabel,
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

  const effectiveA11yLabel = accessibilityLabel || label || (typeof rest.placeholder === 'string' ? rest.placeholder : 'Text input');

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
            paddingHorizontal: spacing.sm,
            minHeight: 48,
          },
          isFocused && styles.focusedRing,
          isDisabled && styles.disabled,
          style as ViewStyle,
        ]}
      >
        {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}

        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.textTertiary}
          accessibilityRole="none"
          accessibilityLabel={effectiveA11yLabel}
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

      {hasError ? (
        <View style={styles.feedbackRow}>
          <Icon name="alert-circle" size={14} color={colors.danger} />
          <Text role="caption" variant="danger" style={styles.feedbackText}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <View style={styles.feedbackRow}>
          <Text role="caption" variant="tertiary" style={styles.feedbackText}>
            {hint}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

export const Input = TextField;
export type InputProps = TextFieldProps;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 16,
  },
  label: {
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    height: 48,
  },
  focusedRing: {
    borderWidth: 1.5,
  },
  disabled: {
    opacity: 0.5,
  },
  textInput: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    paddingVertical: 0,
    ...Platform.select({
      web: {
        outlineStyle: 'none' as any,
      },
    }),
  },
  leftIcon: {
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightIcon: {
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  feedbackText: {
    fontSize: 12,
  },
});
