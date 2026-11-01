// components/davos/DoingLine.tsx
// Canonical component for Object: Doing (PRD §3, §12).
// A Doing represents a fact: filled marker, time at RIGHT.
// Must be a different component from PlanItemRow (PRD §3 rule).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '../../theme/tokens/spacing';
import { DoingRecord } from '../../fixtures/davos';

export interface DoingLineProps {
  doing: DoingRecord;
}

export function DoingLine({ doing }: DoingLineProps) {
  return (
    <View style={styles.container}>
      {/* Filled marker (fact) */}
      <Text style={styles.markerText}>●</Text>

      {/* Description of what happened */}
      <Text style={styles.whatText}>
        {doing.what}
        {doing.corrected ? ' (corrected)' : ''}
      </Text>

      {/* Time at RIGHT */}
      <Text style={styles.whenText}>{doing.when}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
    paddingLeft: spacing.md, // Indented under the Plan item
  },
  markerText: {
    paddingHorizontal: spacing.none,
  },
  whatText: {
    flex: 1,
    paddingHorizontal: spacing.none,
  },
  whenText: {
    minWidth: 48,
    textAlign: 'right',
    paddingHorizontal: spacing.none,
  },
});
