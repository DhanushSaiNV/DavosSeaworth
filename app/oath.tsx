// app/oath.tsx
// Screen S4 (Oath Ceremony) — Flow F4 (BREADBOARD.md F4; PRD §0, §7.4, §8, §11, §12, §13, §14).
// Full-screen modal, 2 steps: S4a Draft, then S4b Read-back.
// Uses in-memory oathAdapter only (no real production endpoints).
// No edit or delete affordance on a bound Oath anywhere.
// Uses same shell & theme tokens as other screens: centered column (maxWidth: 640), top bar with back/close and title (PRD D.1).

import React, { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme';
import { spacing, touchTarget, typeRoles } from '../theme/roles';
import { BoundOath, OathDraft, oathAdapter } from '../lib/oathAdapter';
import { OathDraftForm } from '../components/davos/OathDraftForm';
import { OathReadBack } from '../components/davos/OathReadBack';
import { OathStatement } from '../components/davos/OathStatement';
import { Icon } from '../components/ui/Icon';

type CeremonyStep = 'draft' | 'read_back' | 'bound';
type ViewState = 'populated' | 'empty' | 'error';

export default function OathCeremonyScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;

  const [step, setStep] = useState<CeremonyStep>('draft');
  const [viewState, setViewState] = useState<ViewState>('populated');
  const [draft, setDraft] = useState<OathDraft | null>(null);
  const [boundOath, setBoundOath] = useState<BoundOath | null>(null);
  const [isBinding, setIsBinding] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Web: Esc closes modal sheet (PRD AU19, Behaviour Pass)
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && router.canGoBack()) {
          router.back();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [router]);

  // Check for existing draft or bound oath on mount
  useEffect(() => {
    let isMounted = true;
    Promise.all([oathAdapter.getDraft(), oathAdapter.getBoundOath()])
      .then(([savedDraft, savedBound]) => {
        if (!isMounted) return;
        if (savedBound) {
          setBoundOath(savedBound);
          setStep('bound');
        } else if (savedDraft) {
          setDraft(savedDraft);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  // Close handler: keeps draft locally via fake adapter and returns (PRD D.4)
  const handleClose = async () => {
    if (draft) {
      await oathAdapter.saveDraft(draft);
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/chat');
    }
  };

  // Step 1: Advance from Draft to Read-back
  const handleProceedToReadBack = async (newDraft: OathDraft) => {
    setDraft(newDraft);
    await oathAdapter.saveDraft(newDraft);
    setStep('read_back');
  };

  // Step 1: Discard draft
  const handleDiscardDraft = async () => {
    await oathAdapter.discardDraft();
    setDraft(null);
    if (router.canGoBack()) {
      router.back();
    } else {
      setViewState('empty');
    }
  };

  // Step 2: Back to Draft
  const handleBackToDraft = () => {
    setStep('draft');
  };

  // Step 2: Bind Oath (online only, 5-second countdown satisfied)
  const handleBind = async () => {
    if (!draft) return;
    setIsBinding(true);
    setErrorMessage(null);

    try {
      const bound = await oathAdapter.bind(draft);
      setBoundOath(bound);
      setStep('bound');
      setIsBinding(false);

      // Return to Proof showing bound OathStatement (B.4)
      setTimeout(() => {
        router.replace('/(app)/proof');
      }, 1000);
    } catch (err) {
      setIsBinding(false);
      setViewState('error');
      // Exact copy from PRD §11
      setErrorMessage('Not bound. Nothing was saved. Try again.');
    }
  };

  // PRD §11 View states: Empty state
  if (viewState === 'empty') {
    return (
      <View style={[styles.container, { backgroundColor: canvasBg }]}>
        <View style={[styles.topBar, { borderBottomColor: colors.divider }]}>
          <View style={styles.topBarInner}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Davos"
              hitSlop={touchTarget.hitSlop}
              style={styles.navButton}
              onPress={() => router.replace('/(app)/chat')}>
              <Icon name="arrow-left" size={20} color={colors.textPrimary} />
            </Pressable>
            <Text
              style={[styles.topBarTitle, typeRoles.title, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Oath Ceremony
            </Text>
            <View style={styles.topBarSpacer} />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.centeredColumn}>
            <Text
              style={[styles.stateText, typeRoles.davosVoice, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              No Oath. It can't be undone. Start one when you're sure.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start an Oath draft"
              hitSlop={touchTarget.hitSlop}
              style={[styles.actionButton, { borderColor: colors.controlBorder }]}
              onPress={() => {
                setViewState('populated');
                setStep('draft');
              }}>
              <Text
                style={[typeRoles.davosVoice, { color: colors.textPrimary, fontWeight: '500' }]}
                allowFontScaling={true}>
                Start an Oath
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  // PRD §11 View states: Error state
  if (viewState === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: canvasBg }]}>
        <View style={[styles.topBar, { borderBottomColor: colors.divider }]}>
          <View style={styles.topBarInner}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to draft"
              hitSlop={touchTarget.hitSlop}
              style={styles.navButton}
              onPress={() => {
                setViewState('populated');
                setStep('draft');
              }}>
              <Icon name="arrow-left" size={20} color={colors.textPrimary} />
            </Pressable>
            <Text
              style={[styles.topBarTitle, typeRoles.title, { color: colors.textPrimary }]}
              allowFontScaling={true}>
              Oath Ceremony
            </Text>
            <View style={styles.topBarSpacer} />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.centeredColumn}>
            <Text
              style={[styles.stateText, typeRoles.meta, { color: colors.danger }]}
              allowFontScaling={true}>
              {errorMessage ?? 'Not bound. Nothing was saved. Try again.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry binding Oath"
              hitSlop={touchTarget.hitSlop}
              style={[styles.actionButton, { borderColor: colors.controlBorder }]}
              onPress={() => {
                setViewState('populated');
                setStep('read_back');
              }}>
              <Text
                style={[typeRoles.davosVoice, { color: colors.textPrimary, fontWeight: '500' }]}
                allowFontScaling={true}>
                Try again
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      {/* Top bar with back or close control and title (D.1, B.5: same size, same left edge, textPrimary) */}
      <View style={[styles.topBar, { borderBottomColor: colors.divider }]}>
        <View style={styles.topBarInner}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={step === 'read_back' ? 'Back to draft' : 'Close Oath ceremony'}
            hitSlop={touchTarget.hitSlop}
            style={styles.navButton}
            onPress={step === 'read_back' ? handleBackToDraft : handleClose}>
            {step === 'read_back' ? (
              <Icon name="arrow-left" size={20} color={colors.textPrimary} />
            ) : (
              <Icon name="x" size={20} color={colors.textPrimary} />
            )}
          </Pressable>
          <Text
            style={[styles.topBarTitle, typeRoles.title, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Oath Ceremony
          </Text>
          <View style={styles.topBarSpacer} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.centeredColumn}>
          {/* Step indicator: Step 1 of 2: Draft / Step 2 of 2: Read it back (D.3) */}
          {(step === 'draft' || step === 'read_back') && (
            <View style={styles.stepIndicatorRow}>
              <Text
                style={[styles.stepIndicatorText, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                {step === 'draft' ? 'Step 1 of 2: Draft' : 'Step 2 of 2: Read it back'}
              </Text>
            </View>
          )}

          {/* Step 1: Draft (S4a) */}
          {step === 'draft' && (
            <OathDraftForm
              initialDraft={draft}
              onReadBack={handleProceedToReadBack}
              onDiscard={handleDiscardDraft}
            />
          )}

          {/* Step 2: Read-back (S4b) */}
          {step === 'read_back' && draft && (
            <OathReadBack
              draft={draft}
              onBack={handleBackToDraft}
              onBind={handleBind}
              isBinding={isBinding}
            />
          )}

          {/* Bound state: Displays OathStatement (strictly NO edit or delete affordance) */}
          {step === 'bound' && boundOath && (
            <View style={styles.boundContainer}>
              <OathStatement oath={boundOath} />
              <Text
                style={[styles.boundNotice, typeRoles.meta, { color: colors.textSecondary }]}
                allowFontScaling={true}>
                Oath bound. Returning to Proof...
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  topBarInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
  },
  topBarTitle: {
    paddingHorizontal: spacing.none,
  },
  navButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  navButtonText: {
    paddingHorizontal: spacing.none,
  },
  topBarSpacer: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  centeredColumn: {
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
    gap: spacing.sm,
  },
  stepIndicatorRow: {
    paddingVertical: spacing.xxs,
  },
  stepIndicatorText: {
    paddingHorizontal: spacing.none,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  boundContainer: {
    gap: spacing.sm,
  },
  boundNotice: {
    paddingVertical: spacing.xs,
  },
  stateText: {
    paddingVertical: spacing.md,
  },
  actionButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
