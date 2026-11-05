// app/(app)/today.tsx
// Screen S2 (Today) — Plan against actual (Blueprint §3, Redesign Mockup).
// Full width executive schedule view with Plan & Activity tabs.
// Uses only theme/roles.ts. RN primitives only (FlatList, View, Text, Pressable, Modal). No cards, no elevation.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import { TodayPanel } from '../../components/davos/TodayPanel';
import { PlanEditorModal } from '../../components/davos/PlanEditorModal';
import { useDayContext } from '../../domain/DayContext';
import type { PlanAnchor } from '../../domain/daySnapshot';

export default function TodayScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;
  const {
    snapshot,
    setFocusedBeatId,
    planAnchors,
    setPlanAnchors,
    savePlan,
    activityEvents,
    tracker,
  } = useDayContext();

  const [planEditorVisible, setPlanEditorVisible] = useState<boolean>(false);

  const handleSelectBeat = (beatId: string) => {
    setFocusedBeatId(beatId);
    router.navigate('/(app)/chat');
  };

  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      <TodayPanel
        snapshot={snapshot}
        planAnchors={planAnchors}
        activityEvents={activityEvents}
        trackerState={tracker}
        fullWidth={true}
        onSelectBeat={handleSelectBeat}
        onOpenPlanEditor={() => setPlanEditorVisible(true)}
      />

      <PlanEditorModal
        visible={planEditorVisible}
        initialAnchors={planAnchors}
        onClose={() => setPlanEditorVisible(false)}
        onSave={(updated) => {
          if (savePlan) {
            void savePlan(updated);
          } else {
            setPlanAnchors(updated);
          }
        }}
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
