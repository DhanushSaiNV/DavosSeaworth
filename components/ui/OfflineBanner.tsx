// components/ui/OfflineBanner.tsx
// Explicit Offline and Sync Status Banner primitive.
// Rules:
// - Statuses are explicit: offline, pending, synced, failed.
// - Status color is always paired with vector icon and clear text copy.
// - Explains what happened, why, and what to do next.

import React from 'react';
import { View, StyleSheet, Pressable, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Icon } from './Icon';

export type SyncState = 'offline' | 'pending' | 'synced' | 'failed';

export interface OfflineBannerProps {
  status?: SyncState;
  pendingCount?: number;
  onRetry?: () => void;
  style?: ViewStyle;
}

export function OfflineBanner({
  status = 'offline',
  pendingCount = 0,
  onRetry,
  style,
}: OfflineBannerProps) {
  const { colors, spacing, radius } = useTheme();

  if (status === 'synced') return null;

  const getStatusConfig = () => {
    switch (status) {
      case 'pending':
        return {
          icon: 'clock' as const,
          color: colors.warning,
          surface: colors.warningSurface,
          title: 'Sync pending',
          message: pendingCount > 0
            ? `${pendingCount} update${pendingCount > 1 ? 's' : ''} queued locally. Syncing when connection restores.`
            : 'Changes queued locally. Syncing momentarily.',
        };
      case 'failed':
        return {
          icon: 'alert-triangle' as const,
          color: colors.danger,
          surface: colors.dangerSurface,
          title: 'Sync interrupted',
          message: 'Server was unreachable. Tap to retry sync.',
        };
      case 'offline':
      default:
        return {
          icon: 'wifi-off' as const,
          color: colors.textSecondary,
          surface: colors.surfaceSubtle,
          title: 'Working offline',
          message: 'All entries are safely saved locally on this device.',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <Pressable
      accessibilityRole={onRetry ? 'button' : 'none'}
      accessibilityLabel={`${config.title}: ${config.message}`}
      disabled={!onRetry}
      onPress={onRetry}
      style={[
        styles.container,
        {
          backgroundColor: config.surface,
          borderColor: colors.borderSubtle,
          borderRadius: radius.md,
          padding: spacing.xs,
        },
        style,
      ]}
    >
      <View style={styles.iconSlot}>
        <Icon name={config.icon} size={18} color={config.color} />
      </View>
      <View style={styles.textSlot}>
        <Text role="caption" variant="primary" style={styles.titleText}>
          {config.title}
        </Text>
        <Text role="caption" variant="secondary" style={styles.messageText}>
          {config.message}
        </Text>
      </View>
      {onRetry && (
        <View style={styles.actionSlot}>
          <Text role="caption" variant="accent" style={styles.actionText}>
            Retry sync
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  iconSlot: {
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textSlot: {
    flex: 1,
  },
  titleText: {
    fontWeight: '600',
    marginBottom: 2,
  },
  messageText: {
    fontSize: 12,
  },
  actionSlot: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  actionText: {
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
