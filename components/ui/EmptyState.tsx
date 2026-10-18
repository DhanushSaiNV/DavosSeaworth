// components/ui/EmptyState.tsx
// Purposeful Empty State primitive with clear CTA and calm coaching tone

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Button } from './Button';
import { Icon } from './Icon';

export interface EmptyStateProps {
  title: string;
  description: string;
  iconName?: string;
  actionTitle?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function EmptyState({
  title,
  description,
  iconName = 'compass',
  actionTitle,
  onAction,
  style,
}: EmptyStateProps) {
  const { colors, spacing, radius } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: colors.surfaceSubtle,
            borderColor: colors.border,
            borderRadius: radius.full,
          },
        ]}
      >
        <Icon name={iconName} size={28} color={colors.lantern} />
      </View>

      <Text role="title" align="center" style={styles.title}>
        {title}
      </Text>

      <Text
        role="body"
        variant="secondary"
        align="center"
        style={[styles.description, { maxWidth: 320 }]}
      >
        {description}
      </Text>

      {actionTitle && onAction ? (
        <Button
          title={actionTitle}
          onPress={onAction}
          variant="primary"
          style={styles.actionButton}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 16,
  },
  title: {
    marginBottom: 8,
  },
  description: {
    marginBottom: 20,
    lineHeight: 20,
  },
  actionButton: {
    minWidth: 160,
  },
});
