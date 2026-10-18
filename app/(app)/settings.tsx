import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { requireConfigBoolean, useConfig } from '../../lib/config';
import { useAuth } from '../../lib/auth';
import {
  fireCheckinNow,
  getCheckinPermissionState,
  getGrid,
  loadProfileGrid,
  requestCheckinPermission,
  saveCheckinPrefs,
  type CheckinPermissionReading,
} from '../../lib/checkins';
import { windowsForLocalDay, type CadenceMinutes } from '../../lib/checkinGrid';
import {
  ACTIVE_HOURS_STEP_MINUTES,
  CADENCE_OPTIONS,
  cadenceLabel,
  gridFromPrefs,
  prefsFromGrid,
  shiftClock,
  validateCheckinPrefs,
  type CheckinPrefs,
  type CheckinPrefsFailure,
} from '../../lib/checkinSettings';
import {
  DEV_FORCE_TIERS,
  isDevOverridesActive,
  setDevOverrides,
  useDevOverrides,
} from '../../lib/devOverrides';
import copy from '../../content/ui-copy/checkin-settings.json';
import { useTheme } from '../../theme';
import { Screen, Card, Text, Button, Input, Icon, Chip } from '../../components/ui';

const S = copy.strings;

const FAILURE_COPY: Record<CheckinPrefsFailure, string> = {
  cadence_invalid: S.error_cadence_invalid,
  hours_malformed: S.error_hours_malformed,
  hours_order: S.error_hours_order,
};

const DEV_FIRE_COPY: Record<'web' | 'no_grid' | 'denied' | 'no_window', string> = {
  web: 'Web schedules no notifications (FR-2) — use the in-app banner.',
  no_grid: 'Could not read the check-in grid — is the scheduler armed?',
  denied: 'Notification permission is off for this app — grant it, then retry.',
  no_window: 'No check-in window is available to fire for — widen the active hours.',
};

const HOURS_FIELDS = [
  { field: 'activeStart' as const, label: S.active_hours_from },
  { field: 'activeEnd' as const, label: S.active_hours_to },
];

export default function SettingsScreen() {
  const config = useConfig();
  const overrides = useDevOverrides();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { colors, spacing, radius, touchTarget } = useTheme();

  const devTools = useMemo(() => {
    if (!__DEV__ || config.status !== 'loaded') return false;
    try {
      return requireConfigBoolean('dev_overrides_enabled');
    } catch (err) {
      console.warn('[settings] dev_overrides_enabled unavailable:', err);
      return false;
    }
  }, [config.status]);

  const [domainDraft, setDomainDraft] = useState<string | null>(null);
  const domainValue = domainDraft ?? overrides.domain;

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
    setTimezone(grid.timezone);
    setError(null);
    setSaved(false);
    setLoadState('ready');
  }, [userId]);

  useEffect(() => {
    void load();
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

  const hoursInvalid =
    validation !== null &&
    !validation.ok &&
    (validation.reason === 'hours_order' || validation.reason === 'hours_malformed');

  const windowCount = useMemo(() => {
    if (!prefs || !timezone || !userId || !validation?.ok) return null;
    return windowsForLocalDay(gridFromPrefs(prefs, timezone), Date.now(), userId).length;
  }, [prefs, timezone, userId, validation]);

  const editPrefs = (patch: Partial<CheckinPrefs>) => {
    setSaved(false);
    setError(null);
    setPrefs((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const stepHours = (field: 'activeStart' | 'activeEnd', direction: -1 | 1) => {
    setSaved(false);
    setError(null);
    setPrefs((prev) => {
      if (!prev) return prev;
      const next = shiftClock(prev[field], direction * ACTIVE_HOURS_STEP_MINUTES);
      return field === 'activeStart'
        ? { ...prev, activeStart: next }
        : { ...prev, activeEnd: next };
    });
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
      setSaved(true);
    } catch (err) {
      console.warn('[settings] check-in prefs save failed:', err);
      setError(S.error_save);
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

  const commitDomain = () => {
    if (domainDraft === null || domainDraft.trim() === overrides.domain) return;
    void setDevOverrides({ domain: domainDraft });
    setDomainDraft(null);
  };

  const [fireState, setFireState] = useState<string | null>(null);

  const handleFireCheckin = async () => {
    if (!userId) return;
    setFireState('Firing…');
    const result = await fireCheckinNow(userId);
    if (result.ok) {
      setFireState(
        result.answered
          ? 'Fired — this window is already answered, so expect the late path.'
          : 'Fired — a check-in notification arrives in a few seconds.'
      );
      return;
    }
    setFireState(DEV_FIRE_COPY[result.reason]);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Screen scrollable maxWidth={600} contentContainerStyle={styles.container}>
      <Text role="display" style={styles.title}>
        Settings
      </Text>

      {/* Check-ins Section Card */}
      <Card elevation="raised" padding={spacing.lg} style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Icon name="clock" size="md" color={colors.lantern} />
          <Text role="title" style={styles.sectionTitle}>
            {S.section_title}
          </Text>
        </View>
        <Text role="body" variant="secondary" style={styles.sectionIntro}>
          {S.section_intro}
        </Text>

        {loadState === 'loading' ? (
          <Text role="caption" variant="tertiary" style={styles.loadingText}>
            {S.loading}
          </Text>
        ) : null}

        {loadState === 'failed' ? (
          <View style={styles.failContainer}>
            <Text role="body" variant="danger" style={styles.errorText}>
              {S.error_load}
            </Text>
            <Button
              title={S.retry}
              variant="secondary"
              size="sm"
              onPress={() => void load()}
              style={styles.retryButton}
            />
          </View>
        ) : null}

        {loadState === 'ready' && prefs ? (
          <View>
            {/* Cadence */}
            <Text role="caption" variant="secondary" style={styles.fieldLabel}>
              {S.cadence_label}
            </Text>
            <View style={styles.chipRow}>
              {CADENCE_OPTIONS.map((cadence: CadenceMinutes) => {
                const active = prefs.cadenceMinutes === cadence;
                return (
                  <Chip
                    key={cadence}
                    label={cadenceLabel(cadence)}
                    selected={active}
                    onPress={() => editPrefs({ cadenceMinutes: cadence })}
                  />
                );
              })}
            </View>
            <Text role="caption" variant="tertiary" style={styles.fieldHint}>
              {S.cadence_hint}
            </Text>

            {/* Active Hours Steppers */}
            <Text role="caption" variant="secondary" style={styles.fieldLabel}>
              {S.active_hours_label}
            </Text>
            {HOURS_FIELDS.map(({ field, label }) => (
              <View key={field} style={styles.stepperRow}>
                <Text role="bodyMedium" style={styles.stepperLabel}>
                  {label}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={S.earlier}
                  hitSlop={touchTarget.hitSlop}
                  style={({ pressed }) => [
                    styles.stepperButton,
                    {
                      borderColor: hoursInvalid ? colors.danger : colors.border,
                      backgroundColor: pressed ? colors.surfaceSubtle : colors.surface,
                      borderRadius: radius.md,
                    },
                  ]}
                  onPress={() => stepHours(field, -1)}
                >
                  <Icon name="minus" size="sm" color={colors.textPrimary} />
                </Pressable>

                <Text role="title" tabular style={styles.stepperValue}>
                  {prefs[field]}
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={S.later}
                  hitSlop={touchTarget.hitSlop}
                  style={({ pressed }) => [
                    styles.stepperButton,
                    {
                      borderColor: hoursInvalid ? colors.danger : colors.border,
                      backgroundColor: pressed ? colors.surfaceSubtle : colors.surface,
                      borderRadius: radius.md,
                    },
                  ]}
                  onPress={() => stepHours(field, 1)}
                >
                  <Icon name="plus" size="sm" color={colors.textPrimary} />
                </Pressable>
              </View>
            ))}

            {hoursInvalid && validation ? (
              <View style={styles.fieldErrorRow}>
                <View style={[styles.fieldErrorBadge, { backgroundColor: colors.danger }]}>
                  <Text role="caption" style={[styles.fieldErrorBadgeText, { color: colors.onAccent }]}>
                    !
                  </Text>
                </View>
                <Text role="caption" variant="danger">
                  {FAILURE_COPY[validation.reason]}
                </Text>
              </View>
            ) : null}

            <Text role="caption" variant="tertiary" style={styles.fieldHint}>
              {S.active_hours_hint}
            </Text>
            {windowCount !== null ? (
              <Text role="caption" variant="secondary" style={styles.summaryHint}>
                {S.windows_summary.replace('{count}', String(windowCount))}
              </Text>
            ) : null}

            {/* Timezone */}
            <Text role="caption" variant="secondary" style={styles.fieldLabel}>
              {S.timezone_label}
            </Text>
            <Text role="body" variant="primary">
              {timezone}
            </Text>
            <Text role="caption" variant="tertiary" style={styles.fieldHint}>
              {S.timezone_hint}
            </Text>

            {/* Notifications */}
            <Text role="caption" variant="secondary" style={styles.fieldLabel}>
              {S.notifications_label}
            </Text>
            {permission === null ? (
              <Text role="caption" variant="tertiary">
                {S.loading}
              </Text>
            ) : permission.state === 'unsupported' ? (
              <Text role="caption" variant="tertiary">
                {S.notifications_web}
              </Text>
            ) : permission.state === 'granted' ? (
              <View style={styles.grantedRow}>
                <Icon name="check" size="sm" color={colors.success} />
                <Text role="body" variant="success">
                  {S.notifications_granted}
                </Text>
              </View>
            ) : (
              <View style={styles.permActionBox}>
                <Text
                  role="caption"
                  variant={permission.state === 'denied' && !permission.canAskAgain ? 'warning' : 'secondary'}
                  style={styles.permText}
                >
                  {permission.state === 'denied' && !permission.canAskAgain
                    ? S.notifications_denied_hint
                    : S.notifications_ask_hint}
                </Text>
                <Button
                  title={
                    permission.state === 'denied' && !permission.canAskAgain
                      ? S.notifications_open_settings
                      : S.notifications_enable
                  }
                  variant="secondary"
                  size="sm"
                  onPress={() => void handlePermissionPress()}
                  style={styles.permButton}
                />
              </View>
            )}

            {/* Save Button & Feedback */}
            <Button
              title={saving ? S.saving : S.save}
              onPress={() => void handleSave()}
              disabled={saving || !validation?.ok}
              loading={saving}
              size="md"
              fullWidth
              style={styles.saveButton}
            />

            {validation && !validation.ok && !hoursInvalid ? (
              <Text role="caption" variant="danger" style={styles.errorFeedback}>
                {FAILURE_COPY[validation.reason]}
              </Text>
            ) : null}
            {error ? (
              <Text role="caption" variant="danger" style={styles.errorFeedback}>
                {error}
              </Text>
            ) : null}
            {saved ? (
              <View style={styles.savedFeedback}>
                <Icon name="check-circle" size="sm" color={colors.success} />
                <Text role="caption" variant="success" style={styles.savedText}>
                  {S.saved}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>

      {/* Developer Section */}
      {devTools ? (
        <Card elevation="raised" padding={spacing.lg} style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Icon name="terminal" size="md" color={colors.lantern} />
            <Text role="title" style={styles.sectionTitle}>
              Developer
            </Text>
          </View>
          <Text role="caption" variant="secondary" style={styles.sectionIntro}>
            Forces classifier band and domain on outgoing messages. Active only when dev_overrides_enabled is true.
          </Text>

          <Text role="caption" variant="secondary" style={styles.fieldLabel}>
            Tier Forcer
          </Text>
          <View style={styles.chipRow}>
            {DEV_FORCE_TIERS.map((tier) => {
              const active = overrides.tier === tier;
              return (
                <Chip
                  key={tier}
                  label={tier}
                  selected={active}
                  onPress={() => void setDevOverrides({ tier })}
                />
              );
            })}
          </View>

          <Input
            label="Domain Forcer"
            value={domainValue}
            onChangeText={setDomainDraft}
            onBlur={commitDomain}
            onSubmitEditing={commitDomain}
            placeholder="e.g. Career — blank for normal"
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text role="caption" variant="tertiary" style={styles.devActiveHint}>
            {isDevOverridesActive(overrides)
              ? `Active: tier=${overrides.tier}${
                  overrides.domain ? `, domain=${overrides.domain}` : ''
                }`
              : 'No overrides active — bands derived normally.'}
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <Button
            title="Fire a check-in notification now"
            variant="secondary"
            size="md"
            fullWidth
            onPress={() => void handleFireCheckin()}
          />
          <Text role="caption" variant="tertiary" style={styles.fireHint}>
            Triggers a real notification for testing the lockscreen shade or check-in response.
          </Text>
          {fireState ? (
            <Text role="caption" variant="secondary" style={styles.fireStateText}>
              {fireState}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Sign Out Action */}
      <Button
        title="Sign Out"
        variant="destructive"
        size="lg"
        fullWidth
        onPress={handleSignOut}
        style={styles.signOutButton}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 48,
  },
  title: {
    marginBottom: 20,
  },
  sectionCard: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 18,
  },
  sectionIntro: {
    lineHeight: 20,
    marginBottom: 16,
  },
  loadingText: {
    marginVertical: 12,
  },
  failContainer: {
    paddingVertical: 12,
  },
  errorText: {
    marginBottom: 10,
  },
  retryButton: {
    alignSelf: 'flex-start',
  },
  fieldLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  fieldHint: {
    marginTop: 6,
    marginBottom: 4,
    lineHeight: 18,
  },
  summaryHint: {
    marginTop: 4,
    marginBottom: 8,
    fontWeight: '500',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  stepperLabel: {
    width: 60,
  },
  stepperButton: {
    borderWidth: 1,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValue: {
    width: 72,
    textAlign: 'center',
    fontSize: 18,
  },
  fieldErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 6,
  },
  fieldErrorBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  fieldErrorBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  grantedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  permActionBox: {
    marginTop: 4,
  },
  permText: {
    lineHeight: 18,
    marginBottom: 8,
  },
  permButton: {
    alignSelf: 'flex-start',
  },
  saveButton: {
    marginTop: 20,
  },
  errorFeedback: {
    marginTop: 8,
    textAlign: 'center',
  },
  savedFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  savedText: {
    fontWeight: '600',
  },
  devActiveHint: {
    marginTop: 4,
    marginBottom: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  fireHint: {
    marginTop: 6,
    lineHeight: 18,
  },
  fireStateText: {
    marginTop: 8,
    fontWeight: '500',
  },
  signOutButton: {
    marginTop: 8,
  },
});
