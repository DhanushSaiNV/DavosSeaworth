// components/davos/OathReadBack.tsx
// Canonical component for Oath Read-back step (S4b in BREADBOARD F4, PRD §7.4, §8, §11, §12, §13).
// Step 2: Commitment in large type, one plain line "This can't be edited or deleted.", [Back], [Bind].
// [Bind] is disabled for 5 seconds after read-back appears, and when offline.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { spacing, touchTarget } from '../../theme/tokens/spacing';
import { OathDraft } from '../../lib/oathAdapter';

export interface OathReadBackProps {
  draft: OathDraft;
  onBack: () => void;
  onBind: () => void;
  isBinding?: boolean;
}

export function OathReadBack({
  draft,
  onBack,
  onBind,
  isBinding = false,
}: OathReadBackProps) {
  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;

  // 5-second countdown timer per BREADBOARD.md F4 and PRD §7.4
  const [secondsRemaining, setSecondsRemaining] = useState<number>(5);

  useEffect(() => {
    if (secondsRemaining <= 0) return;

    const timer = setTimeout(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [secondsRemaining]);

  const canBind = secondsRemaining === 0 && !isOffline && !isBinding;

  return (
    <View style={styles.container}>
      {/* 1. Step title (PRD §8 layout order) */}
      <Text style={styles.stepTitle}>Read back your Oath</Text>

      {/* 2. Commitment in large type (PRD §7.4, §8) */}
      <View style={styles.commitmentContainer}>
        <Text style={styles.commitmentText}>{draft.commitmentText}</Text>
      </View>

      {/* 3. Review date plain line */}
      <View style={styles.reviewDateContainer}>
        <Text style={styles.reviewDateText}>
          Review date: {draft.reviewDate}
        </Text>
      </View>

      {/* 4. One plain line: exact PRD §13 / BREADBOARD F4 copy */}
      <View style={styles.warningContainer}>
        <Text style={styles.warningLine}>This can't be edited or deleted.</Text>
      </View>

      {/* Offline status notice per PRD §11 */}
      {isOffline && (
        <View style={styles.offlineContainer}>
          <Text style={styles.offlineText}>Needs a connection.</Text>
        </View>
      )}

      {/* 5. Actions: [Back], [Bind] (PRD §8) */}
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to draft"
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={onBack}>
          <Text>Back</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            canBind
              ? 'Bind Oath'
              : secondsRemaining > 0
              ? `Bind Oath disabled (${secondsRemaining} seconds remaining)`
              : 'Bind Oath disabled (Needs a connection)'
          }
          disabled={!canBind}
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={onBind}>
          <Text>
            {isBinding
              ? 'Binding...'
              : secondsRemaining > 0
              ? `Bind (${secondsRemaining}s)`
              : isOffline
              ? 'Needs connection'
              : 'Bind'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  stepTitle: {
    paddingVertical: spacing.xxs,
  },
  commitmentContainer: {
    paddingVertical: spacing.sm,
  },
  commitmentText: {
    paddingHorizontal: spacing.none,
  },
  reviewDateContainer: {
    paddingVertical: spacing.xxs,
  },
  reviewDateText: {
    paddingHorizontal: spacing.none,
  },
  warningContainer: {
    paddingVertical: spacing.xs,
  },
  warningLine: {
    paddingHorizontal: spacing.none,
  },
  offlineContainer: {
    paddingVertical: spacing.xxs,
  },
  offlineText: {
    paddingHorizontal: spacing.none,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm, // Discard/Back at least 16 from Bind per PRD §8
    paddingTop: spacing.sm,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
