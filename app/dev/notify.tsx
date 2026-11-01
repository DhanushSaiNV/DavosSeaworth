// app/dev/notify.tsx
// Dev-only screen for testing Flow F1 local notification scheduling and landing.
// Refs: expo-notifications SDK 57 docs; design/BREADBOARD.md F1; design/DESIGN_PRD.md §7.1

import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { spacing, touchTarget } from '../../theme/tokens/spacing';

export default function DevNotifyScreen() {
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState<string>('Ready to schedule test notification.');
  const [scheduledId, setScheduledId] = useState<string | null>(null);

  const isWeb = Platform.OS === 'web';
  const promptText = '14:00. Plan says deep work. Did you do it?';

  const handleSchedule = async () => {
    if (isWeb) {
      setStatusMessage('Local scheduled notifications are not supported on web. Open S1 directly.');
      return;
    }

    try {
      // 1. Request permissions if not yet granted
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        setStatusMessage('Notification permissions not granted.');
        return;
      }

      // Ensure foreground presentation is enabled for local test
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      // 2. Schedule local notification 10 seconds ahead
      const trigger: Notifications.TimeIntervalTriggerInput = {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 10,
        repeats: false,
      };

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Davos Check-in',
          body: promptText,
          data: {
            url: '/(app)/chat',
            prompt: promptText,
          },
        },
        trigger,
      });

      setScheduledId(id);
      setStatusMessage('Scheduled notification for 10s ahead. Background or terminate the app to test warm/cold start.');
    } catch (err: any) {
      setStatusMessage(`Failed to schedule notification: ${err?.message ?? String(err)}`);
    }
  };

  const handleGoToChat = () => {
    router.push('/(app)/chat');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>F1 Notification Test Harness</Text>
      <Text style={styles.platformText}>Platform: {Platform.OS}</Text>

      {/* Target notification details */}
      <View style={styles.detailsBox}>
        <Text style={styles.label}>Target Route: /(app)/chat (Screen S1)</Text>
        <Text style={styles.label}>Prompt: {promptText}</Text>
        <Text style={styles.label}>Delay: 10 seconds</Text>
      </View>

      {/* Status feedback */}
      <Text style={styles.statusText}>{statusMessage}</Text>
      {scheduledId ? <Text style={styles.idText}>Notification ID: {scheduledId}</Text> : null}

      {/* Action controls */}
      <View style={styles.buttonRow}>
        {!isWeb ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Schedule test notification in 10 seconds"
            hitSlop={touchTarget.hitSlop}
            style={styles.actionButton}
            onPress={handleSchedule}>
            <Text>Schedule 10s Notification</Text>
          </Pressable>
        ) : (
          <Text style={styles.webNotice}>
            Local notifications unavailable on web. Open S1 Thread directly to test prompt display.
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open S1 Thread screen"
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={handleGoToChat}>
          <Text>Open S1 Thread</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  title: {
    paddingVertical: spacing.xxs,
  },
  platformText: {
    paddingHorizontal: spacing.none,
  },
  detailsBox: {
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
  },
  label: {
    paddingHorizontal: spacing.none,
  },
  statusText: {
    paddingVertical: spacing.xs,
  },
  idText: {
    paddingHorizontal: spacing.none,
  },
  buttonRow: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webNotice: {
    paddingVertical: spacing.xs,
  },
});
