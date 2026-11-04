// app/(app)/today.tsx
// Screen S2 (Today) — Plan against actual (Blueprint §3, Roadmap).
// Full width timeline view on the continuous agenda spine.
// Uses only theme/roles.ts. RN primitives only (FlatList, View, Text, Pressable). No cards, no elevation.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import { TodayPanel } from '../../components/davos/TodayPanel';
import { useDayContext } from '../../domain/DayContext';

export default function TodayScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;
  const { snapshot, setFocusedBeatId } = useDayContext();

  const handleSelectBeat = (beatId: string) => {
    setFocusedBeatId(beatId);
    router.navigate('/(app)/chat');
  };

  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      <TodayPanel
        snapshot={snapshot}
        fullWidth={true}
        onSelectBeat={handleSelectBeat}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
});
