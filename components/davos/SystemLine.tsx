// components/davos/SystemLine.tsx
// Canonical component for Object: Thread event line (Blueprint §2.2).
// Props: text or label
// Event line (missed window, urge): meta 12/16/500 textSecondary.
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  typeRoles,
} from '../../theme/roles';

export interface SystemLineProps {
  text?: string;
  label?: string;
  state?: 'sync' | 'missed';
  colorScheme?: 'light' | 'dark';
}

export function SystemLine({
  text,
  label,
  colorScheme,
}: SystemLineProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const content = label ?? text ?? '';

  return (
    <View style={styles.container}>
      <Text
        style={[
          styles.text,
          typeRoles.meta,
          {
            color: colors.textSecondary,
            fontWeight: '500',
            lineHeight: 16,
          },
        ]}
        allowFontScaling={true}>
        {content}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    width: '100%',
  },
  text: {
    paddingHorizontal: spacing.none,
    textAlign: 'left',
  },
});
