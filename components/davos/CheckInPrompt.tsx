// components/davos/CheckInPrompt.tsx
// Canonical component for Object: Check-in prompt (Blueprint §2.4).
// Text drops the time prefix because the gutter carries it.
// Integrates ResponseRow ruled strip directly under the prompt text.
// Uses theme roles. RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import { spacing, typeRoles } from '../../theme/roles';
import { PlanItemLike, stripLeadingTime } from '../../domain/daySnapshot';
import {
  CheckInResponseOption,
  ResponseRow,
  ResponseOptionItem,
  DEFAULT_CHECKIN_OPTIONS,
} from './ResponseRow';

export interface CheckInPromptProps {
  interval: string;
  planItem?: PlanItemLike | null;
  status: 'pending' | 'answered' | 'missed';
  customPrompt?: string;
  options?: ResponseOptionItem[];
  onSelectResponse?: (response: CheckInResponseOption) => void;
  onSomethingElse?: () => void;
  selectedOption?: CheckInResponseOption | null;
  colorScheme?: 'light' | 'dark';
}

export function CheckInPrompt({
  interval,
  planItem,
  status,
  customPrompt,
  options = DEFAULT_CHECKIN_OPTIONS,
  onSelectResponse = () => {},
  onSomethingElse,
  selectedOption = null,
  colorScheme,
}: CheckInPromptProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const hasPlan = planItem !== null && planItem !== undefined;

  const rawPrompt = customPrompt
    ? customPrompt
    : hasPlan
    ? `Plan says ${planItem.text}. Did you do it?`
    : 'What did you do this hour?';

  // Strip any accidental leading "18:00. " prefix since gutter carries it (Blueprint §2.4)
  const promptText = stripLeadingTime(rawPrompt);

  const groupAccessibilityLabel = hasPlan
    ? `Response to ${interval} check-in: ${planItem.text}`
    : `Response to ${interval} check-in`;

  const handleSelect = (option: CheckInResponseOption) => {
    if (option === 'something_else' && onSomethingElse) {
      onSomethingElse();
      return;
    }
    onSelectResponse(option);
  };

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`Davos said: ${promptText}`}>
      {/* Live prompt text: davosVoice 15/22/500 textPrimary */}
      <Text
        style={[
          styles.promptText,
          typeRoles.davosVoice,
          { color: colors.textPrimary, fontWeight: '500' },
        ]}
        allowFontScaling={true}>
        {promptText}
      </Text>

      {/* Ruled response option strip */}
      {status === 'pending' && (
        <ResponseRow
          options={options}
          onSelect={handleSelect}
          selectedOption={selectedOption}
          groupAccessibilityLabel={groupAccessibilityLabel}
          colorScheme={colorScheme}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.none,
    alignItems: 'flex-start',
    width: '100%',
  },
  promptText: {
    paddingHorizontal: spacing.none,
    textAlign: 'left',
  },
});
