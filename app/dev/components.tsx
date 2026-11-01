// app/dev/components.tsx
// Dev-only visual test harness rendering Group G1 Thread components.
// Renders every component in every listed state: dark and light side by side.
// Uses only theme/roles.ts. RN primitives only. No cards, no elevation.

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  colorRoles,
  spacing,
  typeRoles,
} from '../../theme/roles';
import { DavosMessage } from '../../components/davos/DavosMessage';
import { UserMessage } from '../../components/davos/UserMessage';
import { SystemLine } from '../../components/davos/SystemLine';
import { StatusLine } from '../../components/davos/StatusLine';
import { Composer } from '../../components/davos/Composer';

export default function DevComponentsScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 800;

  const renderGroupG1 = (scheme: 'light' | 'dark') => {
    const colors = colorRoles[scheme];

    return (
      <View
        style={[
          styles.column,
          {
            backgroundColor: colors.surface,
            borderColor: colors.divider,
          },
        ]}>
        <Text
          style={[
            styles.columnHeader,
            typeRoles.heading,
            { color: colors.textPrimary },
          ]}
          allowFontScaling={true}>
          {scheme.toUpperCase()} SCHEME
        </Text>

        {/* 1. StatusLine: normal & offline states */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            StatusLine (normal)
          </Text>
          <StatusLine
            nextCheckIn="15:00"
            progress="3 of 5 check-ins"
            syncState="normal"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            StatusLine (offline)
          </Text>
          <StatusLine
            nextCheckIn="15:00"
            progress="3 of 5 check-ins"
            syncState="offline"
            colorScheme={scheme}
          />
        </View>

        {/* 2. SystemLine: sync & missed states */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            SystemLine (sync)
          </Text>
          <SystemLine
            text="Syncing 2 offline check-ins..."
            state="sync"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            SystemLine (missed)
          </Text>
          <SystemLine
            text="13:00 check-in recorded as missed."
            state="missed"
            colorScheme={scheme}
          />
        </View>

        {/* 3. DavosMessage: default, expanded "Why this?", plain */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            DavosMessage (default with ruleId)
          </Text>
          <DavosMessage
            text="Plan says deep work. Did you do it?"
            time="14:00"
            ruleId="R14"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            DavosMessage (expanded "Why this?")
          </Text>
          <DavosMessage
            text="Name the urge. Stay with me ten minutes."
            time="14:05"
            ruleId="R72"
            defaultExpanded={true}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            DavosMessage (default without ruleId)
          </Text>
          <DavosMessage
            text="Logged. Next check-in 15:00."
            time="14:02"
            colorScheme={scheme}
          />
        </View>

        {/* 4. UserMessage: sent, sending, failed */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            UserMessage (sent)
          </Text>
          <UserMessage
            text="Worked on compiler AST slice."
            time="14:01"
            sendState="sent"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            UserMessage (sending)
          </Text>
          <UserMessage
            text="Heading out for lunch."
            time="14:02"
            sendState="sending"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            UserMessage (failed with retry)
          </Text>
          <UserMessage
            text="Finished afternoon review."
            time="14:03"
            sendState="failed"
            onRetry={() => {}}
            colorScheme={scheme}
          />
        </View>

        {/* 5. Composer: enabled (populated/empty), disabled, offline */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Composer (enabled - populated)
          </Text>
          <Composer
            value="Drafting plan for tomorrow"
            state="enabled"
            onSend={() => {}}
            onUrge={() => {}}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Composer (enabled - empty)
          </Text>
          <Composer
            value=""
            state="enabled"
            onSend={() => {}}
            onUrge={() => {}}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Composer (disabled)
          </Text>
          <Composer
            value="Disabled input state"
            state="disabled"
            onSend={() => {}}
            onUrge={() => {}}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Composer (offline)
          </Text>
          <Composer
            value="Offline queue message"
            state="offline"
            onSend={() => {}}
            onUrge={() => {}}
            colorScheme={scheme}
          />
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.mainTitle, typeRoles.heading]} allowFontScaling={true}>
        Group G1 Thread Component Gallery
      </Text>
      <Text style={[styles.mainSubtitle, typeRoles.meta]} allowFontScaling={true}>
        DavosMessage, UserMessage, SystemLine, StatusLine, Composer — Light & Dark side-by-side
      </Text>

      <View style={[styles.rowContainer, isWide ? styles.row : styles.columnStack]}>
        {renderGroupG1('light')}
        {renderGroupG1('dark')}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  mainTitle: {
    paddingVertical: spacing.xxs,
  },
  mainSubtitle: {
    paddingBottom: spacing.xs,
  },
  rowContainer: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
  },
  columnStack: {
    flexDirection: 'column',
  },
  column: {
    flex: 1,
    padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  columnHeader: {
    paddingBottom: spacing.xxs,
  },
  section: {
    gap: spacing.xxs,
  },
  sectionTitle: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
  },
});
