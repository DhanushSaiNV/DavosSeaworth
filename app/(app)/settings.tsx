import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { requireConfigBoolean, useConfig } from '../../lib/config';
import { useAuth } from '../../lib/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

/**
 * Settings: the check-in preferences (FP-04 Step 7, FR-17) plus the Step 6 developer forcer.
 *
 * Check-ins are the FP-01 stub becoming real: cadence, active hours, a read-only timezone, and
 * the notification-permission state with the R-4 warning. Saving writes the four `profiles`
 * columns through the validated `update_checkin_prefs` RPC and re-arms the scheduler (FR-17) —
 * re-arm is what publishes the new grid to chat's check-in mode and the web banner.
 *
 * The forcer pins the classifier's confidence band and/or domain so every persona tier can be
 * exercised on a device (FR-7, FR-10). It is a dev-only surface behind two independent gates —
 * a dev build and `dev_overrides_enabled` (AGENTS.md §2); the server re-checks the flag itself,
 * so this UI is convenience, never the enforcement point.
 *
 * The copy is a DRAFT owner-content file (`content/ui-copy/checkin-settings.json`) per the
 * AGENTS.md §8.4 amendment — it is referenced, never inlined, so approval is a one-file change.
 */
const S = copy.strings;

/** The validation mirror's reasons in the copy's words. */
const FAILURE_COPY: Record<CheckinPrefsFailure, string> = {
  cadence_invalid: S.error_cadence_invalid,
  hours_malformed: S.error_hours_malformed,
  hours_order: S.error_hours_order,
};

/**
 * The dev drill's failure copy. These strings stay inline on purpose: §8.4's owner-content rule
 * covers the user-facing check-in copy (`content/ui-copy/checkin-settings.json`), not the
 * Developer section, whose existing hint is inline too.
 */
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
  // The screen renders with no header; the inset replaces the old hardcoded 64pt offset
  // so the title clears the status bar on every device without dead space on others.
  const insets = useSafeAreaInsets();

  // Fail closed: only render the forcer when the key is present AND a real boolean true.
  const devTools = useMemo(() => {
    if (!__DEV__ || config.status !== 'loaded') return false;
    try {
      return requireConfigBoolean('dev_overrides_enabled');
    } catch (err) {
      console.warn('[settings] dev_overrides_enabled unavailable:', err);
      return false;
    }
  }, [config.status]);

  // The domain is free text and committed on blur/submit, so a keystroke does not write
  // to storage. `null` means "not edited yet" — track the stored value until then, so a
  // late load still lands in the field.
  const [domainDraft, setDomainDraft] = useState<string | null>(null);
  const domainValue = domainDraft ?? overrides.domain;

  // ---------------------------------------------------------------- check-ins (Step 7)
  // Seeded from the scheduler's cached grid, then re-read authoritatively: a late arm must still
  // land in an open form (the same "late load still lands" rule as the domain field).
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
    // Keep a seeded form on screen while the authoritative read lands (no flash); the retry
    // path from `failed` still shows the spinner.
    setLoadState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    const grid = await loadProfileGrid(userId);
    const next = grid ? prefsFromGrid(grid) : null;
    if (!grid || !next) {
      // Fail closed: a grid that cannot be read is reported, never rendered as a blank form.
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

  // Permission: read on mount and again on every return to the foreground, because the
  // "open system settings" path leaves the app — a stale reading would defeat the row.
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

  // Hours failures are stepper failures, so their message attaches to the steppers
  // (red outline + inline hint) instead of the error slot by the Save button. The
  // remaining reasons have no reachable field (the cadence chips are fixed options),
  // so they keep the generic slot.
  const hoursInvalid =
    validation !== null &&
    !validation.ok &&
    (validation.reason === 'hours_order' || validation.reason === 'hours_malformed');

  // The live reading of the chosen grid: how many check-ins a full day would hold. Cheap, pure,
  // and the only immediate feedback the cadence/hours controls have.
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
    // The side effects stay outside the updater: an updater must be pure (React may invoke it
    // twice), so nothing but the next `prefs` is computed inside it.
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
      // The RPC's own message is a Postgres exception — the user gets the copy, the log gets
      // the detail.
      console.warn('[settings] check-in prefs save failed:', err);
      setError(S.error_save);
    } finally {
      setSaving(false);
    }
  };

  const handlePermissionPress = async () => {
    if (!permission) return;
    if (permission.state === 'denied' && !permission.canAskAgain) {
      // The OS will not show the prompt again — its own settings screen is the only path.
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

  // ------------------------------------------------------------------ dev drill (Step 4/5)

  /**
   * The drill's outcome is always rendered, success or failure: a silent no-op is exactly how a
   * denied permission or an unloaded grid hides, which is the R-4 lesson (FR-17).
   */
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
    >
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{S.section_title}</Text>
        <Text style={styles.hint}>{S.section_intro}</Text>

        {loadState === 'loading' ? <Text style={styles.label}>{S.loading}</Text> : null}

        {loadState === 'failed' ? (
          <View>
            <Text style={styles.error}>{S.error_load}</Text>
            <Pressable
              style={styles.secondaryButton}
              accessibilityRole="button"
              onPress={() => void load()}>
              <Text style={styles.secondaryButtonText}>{S.retry}</Text>
            </Pressable>
          </View>
        ) : null}

        {loadState === 'ready' && prefs ? (
          <View>
            <Text style={styles.label}>{S.cadence_label}</Text>
            <View style={styles.tierRow}>
              {CADENCE_OPTIONS.map((cadence: CadenceMinutes) => {
                const active = prefs.cadenceMinutes === cadence;
                return (
                  <Pressable
                    key={cadence}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => editPrefs({ cadenceMinutes: cadence })}
                    style={[styles.tierChip, active && styles.tierChipActive]}>
                    <Text style={[styles.tierText, active && styles.tierTextActive]}>
                      {cadenceLabel(cadence)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>{S.cadence_hint}</Text>

            <Text style={styles.label}>{S.active_hours_label}</Text>
            {HOURS_FIELDS.map(({ field, label }) => (
              <View key={field} style={styles.stepperRow}>
                <Text style={styles.stepperLabel}>{label}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={S.earlier}
                  style={[styles.stepperButton, hoursInvalid && styles.stepperButtonInvalid]}
                  onPress={() => stepHours(field, -1)}>
                  <Text style={styles.stepperButtonText}>-</Text>
                </Pressable>
                <Text style={styles.stepperValue}>{prefs[field]}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={S.later}
                  style={[styles.stepperButton, hoursInvalid && styles.stepperButtonInvalid]}
                  onPress={() => stepHours(field, 1)}>
                  <Text style={styles.stepperButtonText}>+</Text>
                </Pressable>
              </View>
            ))}
            {hoursInvalid && validation ? (
              <View style={styles.fieldErrorRow}>
                <View style={styles.fieldErrorBadge}>
                  <Text style={styles.fieldErrorBadgeText}>!</Text>
                </View>
                <Text style={styles.fieldErrorText}>{FAILURE_COPY[validation.reason]}</Text>
              </View>
            ) : null}
            <Text style={styles.hint}>{S.active_hours_hint}</Text>
            {windowCount !== null ? (
              <Text style={styles.hint}>
                {S.windows_summary.replace('{count}', String(windowCount))}
              </Text>
            ) : null}

            <Text style={styles.label}>{S.timezone_label}</Text>
            <Text style={styles.hint}>
              {timezone} — {S.timezone_hint}
            </Text>

            <Text style={styles.label}>{S.notifications_label}</Text>
            {permission === null ? (
              <Text style={styles.hint}>{S.loading}</Text>
            ) : permission.state === 'unsupported' ? (
              // Web schedules nothing: the banner is its check-in surface (FR-4, D1).
              <Text style={styles.hint}>{S.notifications_web}</Text>
            ) : permission.state === 'granted' ? (
              <Text style={styles.hint}>{S.notifications_granted}</Text>
            ) : (
              <View>
                {permission.state === 'denied' && !permission.canAskAgain ? (
                  <Text style={styles.warning}>{S.notifications_denied_hint}</Text>
                ) : (
                  <Text style={styles.hint}>{S.notifications_ask_hint}</Text>
                )}
                <Pressable
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                  onPress={() => void handlePermissionPress()}>
                  <Text style={styles.secondaryButtonText}>
                    {permission.state === 'denied' && !permission.canAskAgain
                      ? S.notifications_open_settings
                      : S.notifications_enable}
                  </Text>
                </Pressable>
              </View>
            )}

            <Pressable
              disabled={saving || !validation?.ok}
              onPress={() => void handleSave()}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving || !validation?.ok }}
              style={[
                styles.saveButton,
                (saving || !validation?.ok) && styles.saveButtonDisabled,
              ]}>
              <Text style={styles.saveButtonText}>{saving ? S.saving : S.save}</Text>
            </Pressable>

            {/* Hours failures render at the steppers; only the rest fall through here. */}
            {validation && !validation.ok && !hoursInvalid ? (
              <Text style={styles.error}>{FAILURE_COPY[validation.reason]}</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {saved ? <Text style={styles.success}>✓ {S.saved}</Text> : null}
          </View>
        ) : null}
      </View>

      {devTools ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Developer</Text>
          <Text style={styles.hint}>
            Forces the classifier band and/or domain on every message you send. Ignored
            unless `dev_overrides_enabled` is true in the project config.
          </Text>

          <Text style={styles.label}>Tier forcer</Text>
          <View style={styles.tierRow}>
            {DEV_FORCE_TIERS.map((tier) => {
              const active = overrides.tier === tier;
              return (
                <Pressable
                  key={tier}
                  onPress={() => void setDevOverrides({ tier })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.tierChip, active && styles.tierChipActive]}>
                  <Text style={[styles.tierText, active && styles.tierTextActive]}>
                    {tier}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Domain forcer</Text>
          <TextInput
            style={styles.input}
            value={domainValue}
            onChangeText={setDomainDraft}
            onBlur={commitDomain}
            onSubmitEditing={commitDomain}
            placeholder="e.g. Career — blank for none"
            placeholderTextColor="#999"
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={styles.hint}>
            {isDevOverridesActive(overrides)
              ? `Active: tier=${overrides.tier}${
                  overrides.domain ? `, domain=${overrides.domain}` : ''
                }`
              : 'No override — bands are derived normally.'}
          </Text>

          <Text style={styles.label}>Check-in drill</Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => void handleFireCheckin()}
            accessibilityRole="button"
            accessibilityLabel="Fire a check-in notification now">
            <Text style={styles.secondaryButtonText}>Fire a check-in notification now</Text>
          </Pressable>
          <Text style={styles.hint}>
            One real check-in notification for the window in play, a few seconds from now — tap
            it, or reply from the shade, instead of waiting for a close (TECH-SPEC §7.1).
          </Text>
          {fireState ? <Text style={styles.hint}>{fireState}</Text> : null}
        </View>
      ) : null}

      <Pressable
        style={styles.button}
        onPress={handleSignOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out">
        <Text style={styles.buttonText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#333',
    marginBottom: 24,
  },
  section: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
    backgroundColor: '#fafafa',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    color: '#666',
    marginTop: 12,
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    color: '#666',
  },
  error: {
    fontSize: 12,
    color: '#b00020',
    marginTop: 8,
  },
  success: {
    fontSize: 12,
    color: '#0a7d32',
    marginTop: 8,
  },
  warning: {
    fontSize: 12,
    color: '#8a5a00',
    backgroundColor: '#fff7e6',
    borderWidth: 1,
    borderColor: '#f0d9a8',
    borderRadius: 8,
    padding: 8,
  },
  tierRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tierChip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  tierChipActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  tierText: {
    fontSize: 13,
    color: '#333',
  },
  tierTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepperLabel: {
    fontSize: 13,
    color: '#333',
    width: 48,
  },
  stepperButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    width: 40,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  /** Shape (red outline on the bad field), paired with the inline "!" hint below. */
  stepperButtonInvalid: {
    borderColor: '#c0392b',
  },
  fieldErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 4,
  },
  fieldErrorBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#c0392b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  fieldErrorBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  fieldErrorText: {
    fontSize: 12,
    color: '#b00020',
    flexShrink: 1,
  },
  stepperButtonText: {
    fontSize: 18,
    color: '#111',
    lineHeight: 20,
  },
  stepperValue: {
    fontSize: 16,
    color: '#111',
    fontVariant: ['tabular-nums'],
    width: 64,
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    fontSize: 13,
    color: '#111',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    color: '#111',
  },
  button: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
