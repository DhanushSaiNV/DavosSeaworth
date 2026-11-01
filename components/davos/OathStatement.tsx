// components/davos/OathStatement.tsx
// Canonical component for Object: Oath statement (PRD §3, §12; design/DESIGN.md §6).
// Props: text, boundOn, standing
// States: draft, bound
// MANDATORY RULE (PRD §14 #10, AGENTS.md):
// There must be NO edit or delete affordance on a bound Oath anywhere.
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  typeRoles,
} from '../../theme/roles';
import { BoundOath } from '../../lib/oathAdapter';

export interface OathStatementProps {
  text?: string;
  boundOn?: string;
  standing?: 'in_good_standing' | 'broken' | string;
  state?: 'draft' | 'bound';
  oath?: BoundOath;
  colorScheme?: 'light' | 'dark';
}

export function OathStatement({
  text: propText,
  boundOn: propBoundOn,
  standing: propStanding,
  state: propState,
  oath,
  colorScheme = 'light',
}: OathStatementProps) {
  const colors = colorRoles[colorScheme];

  const commitmentText = oath?.commitmentText ?? propText ?? '';
  const boundOn = oath?.boundAt ?? propBoundOn ?? new Date().toISOString();
  const standing = oath?.standing ?? propStanding ?? 'in_good_standing';
  const state = propState ?? (oath ? 'bound' : 'draft');

  const formattedDate = new Date(boundOn).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // State: draft (Draft Oath statement before ceremony binding)
  if (state === 'draft') {
    return (
      <View style={[styles.container, { borderBottomColor: colors.divider }]}>
        <Text
          style={[styles.header, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Draft Oath Statement (Not Bound)
        </Text>
        <Text
          style={[styles.commitmentText, typeRoles.davosVoice, { color: colors.textPrimary }]}
          allowFontScaling={true}>
          {commitmentText || 'No commitment text entered yet.'}
        </Text>
        <View style={styles.metaRow}>
          <Text
            style={[styles.metaText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Status: Draft in progress
          </Text>
        </View>
      </View>
    );
  }

  // State: bound (Finalized immutable Oath with standing. Strictly NO edit or delete affordance)
  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      <Text
        style={[styles.header, typeRoles.heading, { color: colors.textPrimary }]}
        allowFontScaling={true}>
        Bound Oath
      </Text>
      <Text
        style={[styles.commitmentText, typeRoles.davosVoice, { color: colors.textPrimary }]}
        allowFontScaling={true}>
        {commitmentText}
      </Text>
      <View style={styles.metaRow}>
        <Text
          style={[styles.metaText, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Bound on {formattedDate}
        </Text>
        <Text
          style={[
            styles.standingText,
            typeRoles.meta,
            {
              color: standing === 'in_good_standing' ? colors.textPrimary : colors.danger,
            },
          ]}
          allowFontScaling={true}>
          Standing: {standing}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    alignItems: 'center',
    paddingVertical: spacing.xxs,
  },
  metaText: {
    paddingHorizontal: spacing.none,
  },
  standingText: {
    paddingHorizontal: spacing.none,
  },
});
