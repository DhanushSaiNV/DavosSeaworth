// components/ui/ErrorState.tsx
// Actionable Error State with clear explanation, icon, and retry action.
// Copy rules:
// - Follows "what happened + why + next action".
// - No "Oops", "Something went wrong", or "Invalid".
// - CTA pattern: Verb + Object ("Retry connection", "Reload messages").

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryTitle?: string;
  style?: ViewStyle;
}

export function ErrorState({
  title = 'Connection interrupted',
  message,
  onRetry,
  retryTitle = 'Retry connection',
  style,
}: ErrorStateProps) {
  const { colors, radius } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: colors.dangerSurface,
            borderColor: colors.danger,
            borderRadius: radius.full,
          },
        ]}
      >
        <Icon name="alert-circle" size={24} color={colors.danger} />
      </View>

      <Text role="title" align="center" style={styles.title}>
        {title}
      </Text>

      <Text
        role="body"
        variant="secondary"
        align="center"
        style={styles.message}
      >
        {message}
      </Text>

      {onRetry ? (
        <Button
          title={retryTitle}
          onPress={onRetry}
          variant="secondary"
          size="sm"
          style={styles.retryButton}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  iconCircle: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 14,
  },
  title: {
    marginBottom: 6,
    fontSize: 18,
  },
  message: {
    marginBottom: 16,
    maxWidth: 300,
    lineHeight: 20,
  },
  retryButton: {
    minWidth: 140,
  },
});
