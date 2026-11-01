// app/(app)/settings.tsx
// Screen S5 (Settings) — Single column, no cards, no icon tiles, no pill toggles, no filled navy button.
// Uses SettingsSection and SettingsRow: label on left, control on right, hairlines between rows.
// Refs: design/DESIGN_PRD.md §12, design/AUDIT.md AU29. RN primitives only.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logger } from '../../lib/logger';
import {
  getCheckinPermissionState,
  getGrid,
  loadProfileGrid,
  requestCheckinPermission,
  saveCheckinPrefs,
  type CheckinPermissionReading,
} from '../../lib/checkins';
import {
  ACTIVE_HOURS_STEP_MINUTES,
  CADENCE_OPTIONS,
  cadenceLabel,
  formatClockLabel,
  prefsFromGrid,
  shiftClock,
  validateCheckinPrefs,
  type CheckinPrefs,
  type CheckinPrefsFailure,
} from '../../lib/checkinSettings';
import { parseClock, type CadenceMinutes } from '../../lib/checkinGrid';
import {
  isHapticsEnabled,
  setHapticsEnabled,
  hapticSelection,
  hapticNotifySuccess,
} from '../../lib/haptics';
import { resetAccountData, deleteAccount } from '../../lib/account';
import { colorRoles, spacing, touchTarget, typeRoles } from '../../theme/roles';
import { SettingsSection } from '../../components/davos/SettingsSection';
import { SettingsRow } from '../../components/davos/SettingsRow';
import { DiagnosticsModal } from '../../components/ui';

const FAILURE_COPY: Record<CheckinPrefsFailure, string> = {
  cadence_invalid: 'Choose a valid check-in interval.',
  hours_malformed: 'Check-in hours must be in 24-hour format (e.g. 08:00).',
  hours_order: 'Start time must be earlier than end time.',
};

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const colors = colorRoles.light;

  // Real profile grid data from Supabase (B4: do not hardcode over real saved settings)
  const [prefs, setPrefs] = useState<CheckinPrefs | null>(() => {
    const cached = getGrid();
    return cached ? prefsFromGrid(cached) : null;
  });
  const [timezone, setTimezone] = useState<string | null>(() => getGrid()?.timezone ?? null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>(() =>
    getGrid() ? 'ready' : 'loading'
  );
  const [permission, setPermission] = useState<CheckinPermissionReading | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);

  const initialPrefsRef = useRef<CheckinPrefs | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Load real profile grid
  const load = useCallback(async () => {
    if (!userId) return;
    setLoadState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    const grid = await loadProfileGrid(userId);
    const next = grid ? prefsFromGrid(grid) : null;
    if (!grid || !next) {
      setLoadState('failed');
      return;
    }
    setPrefs(next);
    if (!initialPrefsRef.current) {
      initialPrefsRef.current = next;
    }
    setTimezone(grid.timezone);
    setError(null);
    setSaved(false);
    setLoadState('ready');
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const refresh = async () => {
      const reading = await getCheckinPermissionState();
      if (alive) setPermission(reading);
    };
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [userId]);

  const validation = useMemo(() => (prefs ? validateCheckinPrefs(prefs) : null), [prefs]);

  const hasChanged = useMemo(() => {
    if (!prefs || !initialPrefsRef.current) return false;
    return (
      prefs.cadenceMinutes !== initialPrefsRef.current.cadenceMinutes ||
      prefs.activeStart !== initialPrefsRef.current.activeStart ||
      prefs.activeEnd !== initialPrefsRef.current.activeEnd
    );
  }, [prefs]);

  const editPrefs = (patch: Partial<CheckinPrefs>) => {
    setSaved(false);
    setError(null);
    setPrefs((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  // Step hours by clean 30-minute intervals; end must stay after start (PRD F.5)
  const stepHours = (field: 'activeStart' | 'activeEnd', direction: -1 | 1) => {
    setSaved(false);
    setError(null);
    setPrefs((prev) => {
      if (!prev) return prev;
      const curMinutes = parseClock(prev[field]);
      if (curMinutes === null) return prev;

      let nextMinutes: number;
      if (curMinutes % 30 !== 0) {
        nextMinutes = direction > 0 ? Math.ceil(curMinutes / 30) * 30 : Math.floor(curMinutes / 30) * 30;
      } else {
        nextMinutes = curMinutes + direction * 30;
      }
      nextMinutes = Math.max(0, Math.min(23 * 60 + 30, nextMinutes));

      const startMin = field === 'activeStart' ? nextMinutes : parseClock(prev.activeStart) ?? 0;
      const endMin = field === 'activeEnd' ? nextMinutes : parseClock(prev.activeEnd) ?? 0;

      // End must stay after start (end > start)
      if (field === 'activeStart' && nextMinutes >= endMin) {
        return prev;
      }
      if (field === 'activeEnd' && nextMinutes <= startMin) {
        return prev;
      }

      const nextFormatted = formatClockLabel(nextMinutes);
      void hapticSelection();
      return field === 'activeStart'
        ? { ...prev, activeStart: nextFormatted }
        : { ...prev, activeEnd: nextFormatted };
    });
  };

  // Plain copy haptics state (E4: "Vibrate when you log a check-in.")
  const [hapticsEnabledState, setHapticsEnabledState] = useState(isHapticsEnabled());

  const handleToggleHaptics = (enabled: boolean) => {
    void setHapticsEnabled(enabled);
    setHapticsEnabledState(enabled);
  };

  const handleSave = async () => {
    if (!userId || !prefs || !timezone) return;
    const check = validateCheckinPrefs(prefs);
    if (!check.ok) {
      setSaved(false);
      setError(FAILURE_COPY[check.reason]);
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveCheckinPrefs(userId, prefs, timezone);
      initialPrefsRef.current = prefs;
      setSaved(true);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        setSaved(false);
      }, 3000);
      void hapticNotifySuccess();
    } catch (err) {
      logger.warn('app', 'check-in prefs save failed', undefined, err);
      setError('Could not save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePermissionPress = async () => {
    if (!permission) return;
    if (permission.state === 'denied' && !permission.canAskAgain) {
      await Linking.openSettings();
      return;
    }
    setPermission(await requestCheckinPermission());
  };

  // OPEN Q1: meaning of non-purgable vs account deletion
  const handleWipeData = () => {
    const confirmWipe = async () => {
      try {
        if (!userId) return;
        // OPEN Q1: meaning of non-purgable vs account deletion
        const res = await resetAccountData(userId);
        if (res.ok) {
          router.replace('/(onboarding)/interview');
        } else {
          Alert.alert('Reset failed', 'Could not reset account data.');
        }
      } catch (err) {
        logger.error('app', 'reset data failed', undefined, err);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (
        window.confirm(
          'Wipe all data?\n\nThis will reset your check-ins, plan items, and logged history. Your account remains active and you will restart onboarding.'
        )
      ) {
        void confirmWipe();
      }
      return;
    }

    Alert.alert(
      'Wipe all data?',
      'This will reset your check-ins, plan items, and logged history. Your account remains active and you will restart onboarding.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe data',
          style: 'destructive',
          onPress: () => void confirmWipe(),
        },
      ]
    );
  };

  // OPEN Q1: meaning of non-purgable vs account deletion
  const handleDeleteAccount = () => {
    const confirmDelete = async () => {
      try {
        if (!userId) return;
        // OPEN Q1: meaning of non-purgable vs account deletion
        const res = await deleteAccount(userId);
        if (res.ok) {
          await supabase.auth.signOut();
        } else {
          Alert.alert('Delete failed', 'Could not delete your account.');
        }
      } catch (err) {
        logger.error('app', 'delete account failed', undefined, err);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (
        window.confirm(
          'Delete account permanently?\n\nThis will delete your account and remove your access. This action cannot be undone.'
        )
      ) {
        void confirmDelete();
      }
      return;
    }

    Alert.alert(
      'Delete account permanently?',
      'This will delete your account and remove your access. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => void confirmDelete(),
        },
      ]
    );
  };

  const handleSignOut = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (
        window.confirm(
          'Sign out of account?\n\nYou will need to verify your email to sign back in.'
        )
      ) {
        void supabase.auth.signOut();
      }
      return;
    }

    Alert.alert(
      'Sign out of account?',
      'You will need to verify your email to sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => void supabase.auth.signOut(),
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.content}>
        {loadState === 'loading' && (
          <Text
            style={[styles.noticeText, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            Updating
          </Text>
        )}

        {loadState === 'failed' && (
          <View style={styles.errorBox}>
            <Text
              style={[styles.noticeText, typeRoles.meta, { color: colors.danger }]}
              allowFontScaling={true}>
              Could not load settings.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading settings"
              hitSlop={touchTarget.hitSlop}
              style={[styles.borderedButton, { borderColor: colors.divider }]}
              onPress={() => void load()}>
              <Text
                style={[styles.borderedButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                allowFontScaling={true}>
                Retry
              </Text>
            </Pressable>
          </View>
        )}

        {/* Section 1: Check-ins (PRD F.2) */}
        {prefs ? (
          <SettingsSection
            title="Check-ins"
            description="When and how often Davos checks in.">
            {/* Cadence (PRD F.4) */}
            <SettingsRow
              label="Cadence"
              description="Interval between active check-in questions"
              control={
                <View style={styles.cadenceRow}>
                  {CADENCE_OPTIONS.map((cadence: CadenceMinutes) => {
                    const active = prefs.cadenceMinutes === cadence;
                    return (
                      <Pressable
                        key={cadence}
                        accessibilityRole="button"
                        accessibilityLabel={`Cadence ${cadenceLabel(cadence)}`}
                        accessibilityState={{ selected: active }}
                        hitSlop={touchTarget.hitSlop}
                        style={[
                          styles.segmentButton,
                          {
                            borderColor: active ? colors.textPrimary : colors.divider,
                            borderWidth: active ? 1 : StyleSheet.hairlineWidth,
                            backgroundColor: colors.surface,
                          },
                        ]}
                        onPress={() => editPrefs({ cadenceMinutes: cadence })}>
                        <Text
                          style={[
                            styles.segmentButtonText,
                            typeRoles.meta,
                            {
                              color: colors.textPrimary,
                              fontWeight: active ? '600' : '400',
                            },
                          ]}
                          allowFontScaling={true}>
                          {cadenceLabel(cadence)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              }
            />

            {/* Active hours start (PRD F.5: real minus and plus, 30m steps) */}
            <SettingsRow
              label="Active hours start"
              description="Earliest time Davos may prompt you"
              control={
                <View style={styles.stepperContainer}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Earlier start time"
                    hitSlop={touchTarget.hitSlop}
                    style={[styles.stepperButton, { borderColor: colors.divider }]}
                    onPress={() => stepHours('activeStart', -1)}>
                    <Text
                      style={[styles.stepperButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                      allowFontScaling={true}>
                      {'\u2212'}
                    </Text>
                  </Pressable>
                  <Text
                    style={[styles.stepperValue, typeRoles.figure, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    {prefs.activeStart}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Later start time"
                    hitSlop={touchTarget.hitSlop}
                    style={[styles.stepperButton, { borderColor: colors.divider }]}
                    onPress={() => stepHours('activeStart', 1)}>
                    <Text
                      style={[styles.stepperButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                      allowFontScaling={true}>
                      +
                    </Text>
                  </Pressable>
                </View>
              }
            />

            {/* Active hours end (PRD F.5: real minus and plus, 30m steps) */}
            <SettingsRow
              label="Active hours end"
              description="Latest time Davos may prompt you"
              control={
                <View style={styles.stepperContainer}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Earlier end time"
                    hitSlop={touchTarget.hitSlop}
                    style={[styles.stepperButton, { borderColor: colors.divider }]}
                    onPress={() => stepHours('activeEnd', -1)}>
                    <Text
                      style={[styles.stepperButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                      allowFontScaling={true}>
                      {'\u2212'}
                    </Text>
                  </Pressable>
                  <Text
                    style={[styles.stepperValue, typeRoles.figure, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    {prefs.activeEnd}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Later end time"
                    hitSlop={touchTarget.hitSlop}
                    style={[styles.stepperButton, { borderColor: colors.divider }]}
                    onPress={() => stepHours('activeEnd', 1)}>
                    <Text
                      style={[styles.stepperButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                      allowFontScaling={true}>
                      +
                    </Text>
                  </Pressable>
                </View>
              }
            />

            {/* Timezone */}
            <SettingsRow
              label="Timezone"
              description="Local time basis for active hours"
              control={
                <Text
                  style={[styles.valueText, typeRoles.figure, { color: colors.textPrimary }]}
                  allowFontScaling={true}>
                  {timezone ?? 'UTC'}
                </Text>
              }
            />

            {/* Web notification note (PRD F.2: no FR- IDs) */}
            <SettingsRow
              label="Notifications"
              description={
                Platform.OS === 'web'
                  ? 'On the web, check-ins appear inside the app.'
                  : permission?.state === 'granted'
                  ? 'System notifications active'
                  : 'System notifications off'
              }
              control={
                Platform.OS === 'web' ? (
                  <Text
                    style={[styles.valueText, typeRoles.meta, { color: colors.textSecondary }]}
                    allowFontScaling={true}>
                    In-app
                  </Text>
                ) : permission?.state === 'granted' ? (
                  <Text
                    style={[styles.valueText, typeRoles.meta, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    Granted
                  </Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Enable notifications"
                    hitSlop={touchTarget.hitSlop}
                    style={[styles.borderedButton, { borderColor: colors.divider }]}
                    onPress={() => void handlePermissionPress()}>
                    <Text
                      style={[styles.borderedButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                      allowFontScaling={true}>
                      Enable
                    </Text>
                  </Pressable>
                )
              }
            />

            {/* Save button: disabled until changed (PRD F.6) */}
            <View style={styles.saveActionRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={saving ? 'Saving settings' : 'Save check-in settings'}
                hitSlop={touchTarget.hitSlop}
                disabled={!hasChanged || saving || !validation?.ok}
                style={[
                  styles.saveButton,
                  {
                    borderColor: !hasChanged || saving || !validation?.ok ? colors.divider : colors.textPrimary,
                    opacity: !hasChanged || saving || !validation?.ok ? 0.5 : 1,
                  },
                ]}
                onPress={() => void handleSave()}>
                <Text
                  style={[
                    styles.saveButtonText,
                    typeRoles.davosVoice,
                    {
                      color: !hasChanged || saving || !validation?.ok ? colors.disabled : colors.textPrimary,
                    },
                  ]}
                  allowFontScaling={true}>
                  {saving ? 'Saving...' : 'Save check-in settings'}
                </Text>
              </Pressable>

              {saved && (
                <Text
                  style={[styles.feedbackText, typeRoles.meta, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  Saved
                </Text>
              )}
              {error && (
                <Text
                  style={[styles.feedbackText, typeRoles.meta, { color: colors.danger }]}
                  allowFontScaling={true}>
                  {error}
                </Text>
              )}
            </View>
          </SettingsSection>
        ) : null}

        {/* Section 2: Haptics (PRD F.3: hidden on web, real Switch on native) */}
        {Platform.OS !== 'web' && (
          <SettingsSection
            title="Haptics"
            description="Tactile feedback for key actions.">
            <SettingsRow
              label="Haptic feedback"
              description="Vibrate when you log a check-in."
              control={
                <Switch
                  accessibilityRole="switch"
                  accessibilityLabel="Haptic feedback"
                  value={hapticsEnabledState}
                  onValueChange={(val) => handleToggleHaptics(val)}
                  trackColor={{ false: colors.divider, true: colors.accent }}
                  thumbColor={colors.surface}
                />
              }
            />
          </SettingsSection>
        )}

        {/* Section 3: Diagnostics & Logs (E5: visible only when __DEV__) */}
        {__DEV__ && (
          <SettingsSection
            title="Diagnostics & Logs"
            description="Developer inspection tools for logs and telemetry.">
            <SettingsRow
              label="System Diagnostics"
              description="Inspect structured client logs and export telemetry reports"
              control={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open System Diagnostics"
                  hitSlop={touchTarget.hitSlop}
                  style={[styles.borderedButton, { borderColor: colors.divider }]}
                  onPress={() => setDiagnosticsVisible(true)}>
                  <Text
                    style={[styles.borderedButtonText, typeRoles.meta, { color: colors.textPrimary }]}
                    allowFontScaling={true}>
                    Open
                  </Text>
                </Pressable>
              }
            />
          </SettingsSection>
        )}

        {/* Section 4: Account (E7: sits at bottom with clear spacing) */}
        <SettingsSection
          title="Account"
          description="Manage your data and account session.">
          {/* Wipe data */}
          <SettingsRow
            label="Wipe data"
            description="Reset check-ins, plan, and history to replay onboarding"
            control={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Wipe data"
                hitSlop={touchTarget.hitSlop}
                style={[styles.destructiveButton, { borderColor: colors.divider }]}
                onPress={handleWipeData}>
                <Text
                  style={[styles.destructiveButtonText, typeRoles.meta, { color: colors.danger }]}
                  allowFontScaling={true}>
                  Wipe data
                </Text>
              </Pressable>
            }
          />

          {/* Delete account */}
          <SettingsRow
            label="Delete account"
            description="Permanently delete account and all history"
            control={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete account"
                hitSlop={touchTarget.hitSlop}
                style={[styles.destructiveButton, { borderColor: colors.divider }]}
                onPress={handleDeleteAccount}>
                <Text
                  style={[styles.destructiveButtonText, typeRoles.meta, { color: colors.danger }]}
                  allowFontScaling={true}>
                  Delete
                </Text>
              </Pressable>
            }
          />

          {/* Sign out */}
          <SettingsRow
            label="Sign out"
            description="Sign out on this device"
            hideBorder={true}
            control={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out of account"
                hitSlop={touchTarget.hitSlop}
                style={[styles.borderedButton, { borderColor: colors.divider }]}
                onPress={handleSignOut}>
                <Text
                  style={[styles.borderedButtonText, typeRoles.meta, { color: colors.textSecondary }]}
                  allowFontScaling={true}>
                  Sign out
                </Text>
              </Pressable>
            }
          />
        </SettingsSection>
      </ScrollView>

      {__DEV__ && (
        <DiagnosticsModal
          visible={diagnosticsVisible}
          onClose={() => setDiagnosticsVisible(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollArea: {
    flex: 1,
    width: '100%',
  },
  content: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    gap: spacing.md,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  noticeText: {
    paddingVertical: spacing.xs,
  },
  errorBox: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  cadenceRow: {
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  segmentButton: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    minWidth: 44,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentButtonText: {
    paddingHorizontal: spacing.none,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  stepperButton: {
    borderWidth: StyleSheet.hairlineWidth,
    width: 44,
    height: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperButtonText: {
    paddingHorizontal: spacing.none,
  },
  stepperValue: {
    minWidth: 54,
    textAlign: 'center',
  },
  valueText: {
    paddingHorizontal: spacing.none,
  },
  borderedButton: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    minWidth: 64,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  borderedButtonText: {
    paddingHorizontal: spacing.none,
  },
  toggleButton: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    minWidth: 54,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleButtonText: {
    paddingHorizontal: spacing.none,
  },
  saveActionRow: {
    paddingTop: spacing.xs,
    gap: spacing.xs,
  },
  saveButton: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
  },
  saveButtonText: {
    paddingHorizontal: spacing.none,
  },
  feedbackText: {
    paddingHorizontal: spacing.none,
  },
  destructiveButton: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    minWidth: 64,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  destructiveButtonText: {
    paddingHorizontal: spacing.none,
  },
});
