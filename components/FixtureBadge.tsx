// components/FixtureBadge.tsx
// Dev-only badge indicating fixture/sample data is active (Blueprint §2.6).
// Only renders in __DEV__. Replaces inline per-surface SampleDataMarker tags.
// RN primitives only. "Fixture" = meta, textTertiary, no italic, no blue.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { spacing, typeRoles } from '../theme/roles';

export function FixtureBadge() {
  if (!__DEV__) return null;
  const { colors } = useTheme();

  return (
    <View style={styles.badge} accessible={false}>
      <Text
        style={[styles.text, typeRoles.meta, { color: colors.textTertiary }]}
        allowFontScaling={true}>
        Fixture
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  text: {
    paddingHorizontal: spacing.none,
  },
});
