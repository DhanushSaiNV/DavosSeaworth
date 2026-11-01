// components/davos/OathStatement.tsx
// Canonical component for Object: Oath in bound state (PRD §3, §12).
// Renders the bound commitment text, bound date, and standing.
// MANDATORY RULE (PRD §14 #10, AGENTS.md):
// There must be NO edit or delete affordance on a bound Oath anywhere.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '../../theme/tokens/spacing';
import { BoundOath } from '../../lib/oathAdapter';

export interface OathStatementProps {
  oath: BoundOath;
}

export function OathStatement({ oath }: OathStatementProps) {
  const formattedDate = new Date(oath.boundAt).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Bound Oath</Text>
      <Text style={styles.commitmentText}>{oath.commitmentText}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Bound on {formattedDate}</Text>
        <Text style={styles.standingText}>Standing: {oath.standing}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  header: {
    paddingVertical: spacing.xxs,
  },
  commitmentText: {
    paddingHorizontal: spacing.none,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xxs,
  },
  metaText: {
    paddingHorizontal: spacing.none,
  },
  standingText: {
    paddingHorizontal: spacing.none,
  },
});
