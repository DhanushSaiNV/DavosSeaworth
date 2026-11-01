// app/oath.tsx
// Screen S4 (Oath Ceremony) — Flow F4 (BREADBOARD.md F4; PRD §0, §7.4, §8, §11, §12, §13, §14).
// Full-screen modal, 2 steps: S4a Draft, then S4b Read-back.
// Uses in-memory oathAdapter only (no real production endpoints).
// No edit or delete affordance on a bound Oath anywhere.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { spacing, touchTarget } from '../theme/tokens/spacing';
import { BoundOath, OathDraft, oathAdapter } from '../lib/oathAdapter';
import { OathDraftForm } from '../components/davos/OathDraftForm';
import { OathReadBack } from '../components/davos/OathReadBack';
import { OathStatement } from '../components/davos/OathStatement';

type CeremonyStep = 'draft' | 'read_back' | 'bound';
type ViewState = 'populated' | 'empty' | 'error';

export default function OathCeremonyScreen() {
  const router = useRouter();

  const [step, setStep] = useState<CeremonyStep>('draft');
  const [viewState, setViewState] = useState<ViewState>('populated');
  const [draft, setDraft] = useState<OathDraft | null>(null);
  const [boundOath, setBoundOath] = useState<BoundOath | null>(null);
  const [isBinding, setIsBinding] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

      // Return to thread after brief acknowledgement
      setTimeout(() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(app)/chat');
        }
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
      <View style={styles.container}>
        <Text style={styles.stateText}>
          No Oath. It can't be undone. Start one when you're sure.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start an Oath draft"
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={() => {
            setViewState('populated');
            setStep('draft');
          }}>
          <Text>Start an Oath</Text>
        </Pressable>
      </View>
    );
  }

  // PRD §11 View states: Error state
  if (viewState === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.stateText}>
          {errorMessage ?? 'Not bound. Nothing was saved. Try again.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry binding Oath"
          hitSlop={touchTarget.hitSlop}
          style={styles.actionButton}
          onPress={() => {
            setViewState('populated');
            setStep('read_back');
          }}>
          <Text>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
          <Text style={styles.boundNotice}>
            Oath bound. Returning to Thread...
          </Text>
        </View>
      )}
    </View>
  );
}

// Layout only using spacing scale tokens; no colours, borders, elevation, or custom fonts
const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    justifyContent: 'center',
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
  },
  boundContainer: {
    gap: spacing.sm,
  },
  boundNotice: {
    paddingVertical: spacing.xs,
  },
});
