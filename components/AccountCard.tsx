// components/AccountCard.tsx
// Decision 27 (2026-10-28) / TECH-SPEC §7.13 — the Settings Account card.
//
// Two destructive actions behind one type-to-confirm sheet:
//   * Reset data — dev-only (same gate as the Developer card): wipes rows, keeps the auth
//     user, and re-enters the interview. This is the replay-onboarding valve.
//   * Delete account — user-facing: purges rows and the auth user, then signs out locally.
//
// The modal is `Sheet` (a real modal with its own scroll content) rather than `Alert`, because
// the web build has no `Alert.prompt` and the confirmation must be typed on every platform.
//
// Copy lives in `content/ui-copy/account-settings.json` (DRAFT pending owner sign-off).

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { resetAccountData, deleteAccount } from '../lib/account';
import { logger } from '../lib/logger';
import copy from '../content/ui-copy/account-settings.json';
import { useTheme } from '../theme';
import { Button, Card, Icon, Input, Sheet, Text } from './ui';

const S = copy.strings;

type Mode = 'reset' | 'delete';

function wordFor(mode: Mode): 'RESET' | 'DELETE' {
  return mode === 'reset' ? 'RESET' : 'DELETE';
}

function failureCopy(status: number | undefined, mode: Mode): string {
  if (status === 400) return S.error_confirmation;
  if (status === 401) return S.error_session;
  if (status === 403) return S.error_disabled;
  return mode === 'reset' ? S.error_generic_reset : S.error_generic_delete;
}

export interface AccountCardProps {
  /** The same `__DEV__ && dev_overrides_enabled` gate the Developer card uses. */
  devTools: boolean;
}

export function AccountCard({ devTools }: AccountCardProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { colors, spacing } = useTheme();

  const [mode, setMode] = useState<Mode | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const word = mode ? wordFor(mode) : '';
  const matches = mode !== null && typed === word;

  const open = (next: Mode) => {
    setMode(next);
    setTyped('');
    setError(null);
  };

  const close = () => {
    if (busy) return;
    setMode(null);
    setTyped('');
    setError(null);
  };

  const confirm = async () => {
    if (!user || !mode || !matches || busy) return;
    setBusy(true);
    setError(null);

    try {
      const outcome =
        mode === 'reset' ? await resetAccountData(user.id) : await deleteAccount(user.id);

      if (!outcome.ok) {
        setError(failureCopy(outcome.status, mode));
        return;
      }

      const completed = mode;
      setMode(null);
      setTyped('');

      if (completed === 'reset') {
        // Explicit navigation, never `refreshSession()`: the root auth listener would route
        // a session event to `/(app)/chat`, past the onboarding gate.
        router.replace('/(onboarding)/interview');
      }
      // Delete's local sign-out fires the auth listener, which routes to /sign-in.
    } catch (err) {
      logger.error('app', 'account action failed unexpectedly', undefined, err);
      setError(mode === 'reset' ? S.error_generic_reset : S.error_generic_delete);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card elevation="raised" padding={spacing.lg} style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Icon name="user" size="md" color={colors.textSecondary} />
          <Text role="title" style={styles.sectionTitle}>
            {S.section_title}
          </Text>
        </View>
        <Text role="body" variant="secondary" style={styles.sectionIntro}>
          {S.section_intro}
        </Text>

        {devTools ? (
          <View style={styles.actionBlock}>
            <Text role="caption" variant="tertiary" style={styles.hint}>
              {S.reset_hint}
            </Text>
            <Button
              title={S.reset_button}
              variant="secondary"
              size="md"
              fullWidth
              onPress={() => open('reset')}
            />
          </View>
        ) : null}

        <View style={[styles.actionBlock, devTools && styles.actionBlockSpaced]}>
          <Text role="caption" variant="tertiary" style={styles.hint}>
            {S.delete_hint}
          </Text>
          <Button
            title={S.delete_button}
            variant="destructive"
            size="md"
            fullWidth
            onPress={() => open('delete')}
          />
        </View>
      </Card>

      <Sheet
        visible={mode !== null}
        onClose={close}
        title={mode === 'reset' ? S.modal_reset_title : S.modal_delete_title}
        description={mode === 'reset' ? S.modal_reset_body : S.modal_delete_body}
        footer={
          <View style={styles.footerRow}>
            <Button
              title={S.cancel}
              variant="ghost"
              size="md"
              onPress={close}
              disabled={busy}
              style={styles.footerButton}
            />
            <Button
              title={
                busy
                  ? mode === 'reset'
                    ? S.working_reset
                    : S.working_delete
                  : mode === 'reset'
                    ? S.reset_confirm
                    : S.delete_confirm
              }
              variant="destructive"
              size="md"
              onPress={() => void confirm()}
              disabled={!matches || busy}
              loading={busy}
              style={styles.footerButton}
            />
          </View>
        }
      >
        <Input
          label={S.confirm_label.replace('{word}', word)}
          value={typed}
          onChangeText={setTyped}
          placeholder={S.confirm_placeholder.replace('{word}', word)}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
          error={
            typed.length > 0 && !matches ? S.confirm_mismatch.replace('{word}', word) : null
          }
        />
        {error ? (
          <Text role="caption" variant="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
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
  actionBlock: {
    marginBottom: 4,
  },
  actionBlockSpaced: {
    marginTop: 12,
  },
  hint: {
    lineHeight: 18,
    marginBottom: 8,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  footerButton: {
    flex: 1,
  },
  error: {
    marginTop: 8,
  },
});
