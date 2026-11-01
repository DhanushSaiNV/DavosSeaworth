// app/dev/components.tsx
// Dev-only visual test harness rendering Group G1 (Thread), G2 (Check-in), G3 (Plan and Doing), and G4 (Oath) components.
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
import { CheckInPrompt } from '../../components/davos/CheckInPrompt';
import { ResponseRow } from '../../components/davos/ResponseRow';
import { UndoToast } from '../../components/davos/UndoToast';
import { PlanItemRow } from '../../components/davos/PlanItemRow';
import { PlanList } from '../../components/davos/PlanList';
import { DoingLine } from '../../components/davos/DoingLine';
import { ReflectionEntry } from '../../components/davos/ReflectionEntry';
import { OathStatement } from '../../components/davos/OathStatement';
import { OathDraftForm } from '../../components/davos/OathDraftForm';
import { OathReadBack } from '../../components/davos/OathReadBack';
import { BindButton } from '../../components/davos/BindButton';
import { samplePlanItem, sampleTodayPlanItems } from '../../fixtures/davos';

export default function DevComponentsScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 800;

  const sampleAnswers = {
    q1: 'Morning focus was solid. Afternoon slip occurred during meeting spillover.',
    q2: 'Buffer meeting times and block calendar after 14:00.',
    q3: '1. Ship compiler slice. 2. Verify all states. 3. Audit check.',
  };

  const sampleOathFields = {
    commitmentText: 'I commit to completing my daily core focus block without opening distractions.',
    reviewDate: '2026-12-01',
  };

  const renderComponentGallery = (scheme: 'light' | 'dark') => {
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

        {/* ============================================================ */}
        {/* GROUP G4: OATH CEREMONY & STATEMENT                          */}
        {/* ============================================================ */}
        <View style={styles.groupHeaderContainer}>
          <Text
            style={[styles.groupHeader, typeRoles.heading, { color: colors.accent }]}
            allowFontScaling={true}>
            GROUP G4: OATH
          </Text>
        </View>

        {/* 1. OathStatement: draft & bound states */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            OathStatement (draft)
          </Text>
          <OathStatement
            text="Draft: I will ship the compiler architecture without excuses."
            state="draft"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            OathStatement (bound — immutable, zero edit/delete affordances)
          </Text>
          <OathStatement
            text="I will ship the compiler architecture without excuses."
            boundOn="2026-11-01T12:00:00Z"
            standing="in_good_standing"
            state="bound"
            colorScheme={scheme}
          />
        </View>

        {/* 2. OathDraftForm */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            OathDraftForm (Draft step S4a)
          </Text>
          <OathDraftForm
            fields={sampleOathFields}
            onReadBack={() => {}}
            onDiscard={() => {}}
            colorScheme={scheme}
          />
        </View>

        {/* 3. OathReadBack: disabled (countdown), enabled, error */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            OathReadBack (disabled countdown state)
          </Text>
          <OathReadBack
            fields={sampleOathFields}
            state="disabled"
            onBack={() => {}}
            onBind={() => {}}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            OathReadBack (enabled state — ready to bind)
          </Text>
          <OathReadBack
            fields={sampleOathFields}
            state="enabled"
            onBack={() => {}}
            onBind={() => {}}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            OathReadBack (error state)
          </Text>
          <OathReadBack
            fields={sampleOathFields}
            state="error"
            errorMessage="Not bound. Nothing was saved. Try again."
            onBack={() => {}}
            onBind={() => {}}
            colorScheme={scheme}
          />
        </View>

        {/* 4. BindButton: disabled, enabled, error */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            BindButton (disabled - countdown active)
          </Text>
          <BindButton
            delay={5}
            state="disabled"
            onBind={() => {}}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            BindButton (enabled - ready to bind, accent token)
          </Text>
          <BindButton
            state="enabled"
            onBind={() => {}}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            BindButton (error)
          </Text>
          <BindButton
            state="error"
            onBind={() => {}}
            colorScheme={scheme}
          />
        </View>

        {/* ============================================================ */}
        {/* GROUP G3: PLAN AND DOING COMPONENTS                          */}
        {/* ============================================================ */}
        <View style={styles.groupHeaderContainer}>
          <Text
            style={[styles.groupHeader, typeRoles.heading, { color: colors.accent }]}
            allowFontScaling={true}>
            GROUP G3: PLAN AND DOING
          </Text>
        </View>

        {/* 5. PlanItemRow: pending, done, partly, missed, editing */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanItemRow (pending)
          </Text>
          <PlanItemRow
            text="Deep work on compiler AST slice"
            time="09:00"
            status="pending"
            order={1}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanItemRow (done)
          </Text>
          <PlanItemRow
            text="Morning workout and 5k run"
            time="07:00"
            status="done"
            order={2}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanItemRow (partly)
          </Text>
          <PlanItemRow
            text="Spec review with engineering team"
            time="14:00"
            status="partly"
            order={3}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanItemRow (missed)
          </Text>
          <PlanItemRow
            text="Documentation update"
            time="16:00"
            status="missed"
            order={4}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanItemRow (editing)
          </Text>
          <PlanItemRow
            text="In-place editable item"
            time="17:00"
            status="pending"
            order={5}
            isEditing={true}
            canMoveUp={true}
            canMoveDown={false}
            colorScheme={scheme}
          />
        </View>

        {/* 6. PlanList: populated, empty, loading, error */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanList (populated)
          </Text>
          <PlanList
            items={sampleTodayPlanItems.slice(0, 2)}
            isLockedInitially={false}
            state="populated"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanList (empty)
          </Text>
          <PlanList
            items={[]}
            state="empty"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanList (loading)
          </Text>
          <PlanList
            items={[]}
            state="loading"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            PlanList (error)
          </Text>
          <PlanList
            items={sampleTodayPlanItems.slice(0, 1)}
            state="error"
            colorScheme={scheme}
          />
        </View>

        {/* 7. DoingLine: default & editing */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            DoingLine (default)
          </Text>
          <DoingLine
            what="Completed compiler AST verification"
            when="10:30"
            kind="action"
            corrected={false}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            DoingLine (default with corrected marker)
          </Text>
          <DoingLine
            what="Reviewed specs (was: skipped review)"
            when="14:45"
            kind="action"
            corrected={true}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            DoingLine (editing)
          </Text>
          <DoingLine
            what="Editing logged doing entry"
            when="15:00"
            isEditing={true}
            colorScheme={scheme}
          />
        </View>

        {/* 8. ReflectionEntry: collapsed & expanded */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            ReflectionEntry (collapsed)
          </Text>
          <ReflectionEntry
            date="2026-11-01"
            summary="Strong morning output; afternoon slowed by review meeting."
            answers={sampleAnswers}
            defaultExpanded={false}
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            ReflectionEntry (expanded)
          </Text>
          <ReflectionEntry
            date="2026-11-01"
            summary="Strong morning output; afternoon slowed by review meeting."
            answers={sampleAnswers}
            defaultExpanded={true}
            colorScheme={scheme}
          />
        </View>

        {/* ============================================================ */}
        {/* GROUP G2: CHECK-IN COMPONENTS                                */}
        {/* ============================================================ */}
        <View style={styles.groupHeaderContainer}>
          <Text
            style={[styles.groupHeader, typeRoles.heading, { color: colors.accent }]}
            allowFontScaling={true}>
            GROUP G2: CHECK-IN
          </Text>
        </View>

        {/* 9. CheckInPrompt */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            CheckInPrompt (pending with PlanItem + ResponseRow)
          </Text>
          <CheckInPrompt
            interval="14:00"
            planItem={samplePlanItem}
            status="pending"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            CheckInPrompt (pending without PlanItem)
          </Text>
          <CheckInPrompt
            interval="15:00"
            planItem={null}
            status="pending"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            CheckInPrompt (answered)
          </Text>
          <CheckInPrompt
            interval="13:00"
            planItem={samplePlanItem}
            status="answered"
            colorScheme={scheme}
          />

          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            CheckInPrompt (missed)
          </Text>
          <CheckInPrompt
            interval="12:00"
            planItem={samplePlanItem}
            status="missed"
            colorScheme={scheme}
          />
        </View>

        {/* 10. ResponseRow */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            ResponseRow (active)
          </Text>
          <ResponseRow
            onSelect={() => {}}
            disabled={false}
            colorScheme={scheme}
          />
        </View>

        {/* 11. UndoToast */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            UndoToast (visible)
          </Text>
          <UndoToast
            label="Logged: Deep work"
            timeout={10}
            onUndo={() => {}}
            colorScheme={scheme}
          />
        </View>

        {/* ============================================================ */}
        {/* GROUP G1: THREAD COMPONENTS                                  */}
        {/* ============================================================ */}
        <View style={styles.groupHeaderContainer}>
          <Text
            style={[styles.groupHeader, typeRoles.heading, { color: colors.accent }]}
            allowFontScaling={true}>
            GROUP G1: THREAD
          </Text>
        </View>

        {/* 12. StatusLine */}
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
        </View>

        {/* 13. SystemLine */}
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
        </View>

        {/* 14. DavosMessage */}
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
        </View>

        {/* 15. UserMessage */}
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

        {/* 16. Composer */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Composer (enabled)
          </Text>
          <Composer
            value="Drafting plan for tomorrow"
            state="enabled"
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
        Component Gallery: Groups G1, G2, G3, G4
      </Text>
      <Text style={[styles.mainSubtitle, typeRoles.meta]} allowFontScaling={true}>
        Light & Dark schemes rendered side-by-side using only theme/roles.ts tokens
      </Text>

      <View style={[styles.rowContainer, isWide ? styles.row : styles.columnStack]}>
        {renderComponentGallery('light')}
        {renderComponentGallery('dark')}
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
  groupHeaderContainer: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupHeader: {
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
