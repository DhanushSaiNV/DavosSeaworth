// components/davos/ReflectionEntry.tsx
// Canonical component for Object: Reflection (PRD §3, §12; design/DESIGN.md §6).
// Props: date, summary, answers
// States: collapsed, expanded
// Hairline divider, plain unboxed text, no cards, no elevation.
// Uses only theme/roles.ts. Touch target >= 44dp.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

export interface ReflectionAnswers {
  q1?: string; // what went well, what slipped
  q2?: string; // one lesson
  q3?: string; // tomorrow's things
  [key: string]: string | undefined;
}

export interface ReflectionEntryProps {
  date: string;
  summary: string;
  answers?: ReflectionAnswers;
  defaultExpanded?: boolean;
  colorScheme?: 'light' | 'dark';
}

export function ReflectionEntry({
  date,
  summary,
  answers = {},
  defaultExpanded = false,
  colorScheme = 'light',
}: ReflectionEntryProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const colors = colorRoles[colorScheme];

  const hasAnswers = Object.keys(answers).length > 0;

  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      {/* Date header in meta type role */}
      <Text
        style={[styles.dateText, typeRoles.meta, { color: colors.textSecondary }]}
        allowFontScaling={true}>
        {date} Reflection
      </Text>

      {/* Davos one-line summary in davosVoice */}
      <Text
        style={[styles.summaryText, typeRoles.davosVoice, { color: colors.textPrimary }]}
        allowFontScaling={true}>
        {summary}
      </Text>

      {/* Toggle button to expand/collapse full Q1-Q3 answers */}
      {hasAnswers && (
        <View style={styles.toggleRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isExpanded
                ? `Collapse answers for reflection on ${date}`
                : `Expand answers for reflection on ${date}`
            }
            hitSlop={touchTarget.hitSlop}
            style={[styles.toggleButton, { borderColor: colors.divider }]}
            onPress={() => setIsExpanded((prev) => !prev)}>
            <Text
              style={[styles.toggleButtonText, typeRoles.meta, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              {isExpanded ? 'Hide answers' : 'Show answers'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* State: expanded (answers displayed) */}
      {isExpanded && hasAnswers && (
        <View style={[styles.answersContainer, { borderTopColor: colors.divider }]}>
          {answers.q1 && (
            <View style={styles.answerBlock}>
              <Text
                style={[styles.questionLabel, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                What went well, what slipped:
              </Text>
              <Text
                style={[styles.answerText, typeRoles.userText, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                {answers.q1}
              </Text>
            </View>
          )}

          {answers.q2 && (
            <View style={styles.answerBlock}>
              <Text
                style={[styles.questionLabel, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                One lesson:
              </Text>
              <Text
                style={[styles.answerText, typeRoles.userText, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                {answers.q2}
              </Text>
            </View>
          )}

          {answers.q3 && (
            <View style={styles.answerBlock}>
              <Text
                style={[styles.questionLabel, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                Tomorrow’s three things:
              </Text>
              <Text
                style={[styles.answerText, typeRoles.userText, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                {answers.q3}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
    gap: spacing.xxs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dateText: {
    paddingHorizontal: spacing.none,
  },
  summaryText: {
    paddingHorizontal: spacing.none,
  },
  toggleRow: {
    paddingTop: spacing.xxs,
    alignItems: 'flex-start',
  },
  toggleButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleButtonText: {
    paddingHorizontal: spacing.none,
  },
  answersContainer: {
    paddingTop: spacing.xs,
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  answerBlock: {
    gap: spacing.none,
  },
  questionLabel: {
    paddingHorizontal: spacing.none,
  },
  answerText: {
    paddingHorizontal: spacing.none,
  },
});
