// lib/journal/journalService.ts
// Service layer for the Evening Journal and overnight Anchor Plan pipeline.
// Handles local draft storage, client-side Unsavable stripping, submission to submit-journal,
// and overnight anchor plan simulation for developer verification.
// Refs: ULTIMATE-PRD1 §3.4, §4.4; TECH-SPEC §3.4, §7.2, §7.4; AGENTS.md §4.2.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { stripSummary } from './strip';
import { buildSubmitPayload } from './submitState';
import { logger } from '../logger';
import { saveTodayAnchorPlan, StoredAnchor } from '../todayService';

export const JOURNAL_DRAFT_KEY = 'davos_journal_draft';

export interface JournalDraft {
  raw: string;
  flaggedTexts: string[];
  updatedAt: string;
}

export interface SubmitJournalResult {
  ok: boolean;
  entryId?: string;
  error?: string;
  sentBlocks?: number;
  totalBlocks?: number;
}

/** Load persisted draft from AsyncStorage */
export async function loadJournalDraft(): Promise<JournalDraft | null> {
  try {
    const rawSaved = await AsyncStorage.getItem(JOURNAL_DRAFT_KEY);
    if (!rawSaved) return null;
    const parsed = JSON.parse(rawSaved) as JournalDraft;
    if (typeof parsed?.raw === 'string' && Array.isArray(parsed?.flaggedTexts)) {
      return {
        raw: parsed.raw,
        flaggedTexts: parsed.flaggedTexts.filter((t) => typeof t === 'string'),
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
    return null;
  } catch (err) {
    logger.warn('journal', 'Failed to load journal draft from storage', undefined, err);
    return null;
  }
}

/** Save journal draft to AsyncStorage */
export async function saveJournalDraft(draft: JournalDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(JOURNAL_DRAFT_KEY, JSON.stringify(draft));
  } catch (err) {
    logger.warn('journal', 'Failed to save journal draft to storage', undefined, err);
  }
}

/** Clear journal draft from AsyncStorage */
export async function clearJournalDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(JOURNAL_DRAFT_KEY);
  } catch (err) {
    logger.warn('journal', 'Failed to clear journal draft from storage', undefined, err);
  }
}

/**
 * Submit journal entry to backend submit-journal Edge Function.
 * Enforces client-side Unsavable strip before network transmission (AGENTS.md §4.2).
 */
export async function submitJournalEntry(
  rawText: string,
  flaggedTexts: string[] | Set<string>,
  entryDateOverride?: string
): Promise<SubmitJournalResult> {
  const flaggedSet = flaggedTexts instanceof Set ? flaggedTexts : new Set(flaggedTexts);
  const summary = stripSummary(rawText, flaggedSet);

  if (summary.total === 0 || summary.sent === 0 || !summary.stripped.trim()) {
    return {
      ok: false,
      error: 'Cannot submit empty journal. All blocks may have been marked unsavable.',
      sentBlocks: 0,
      totalBlocks: summary.total,
    };
  }

  const payload = buildSubmitPayload(rawText, flaggedSet);
  if (entryDateOverride) {
    payload.entry_date = entryDateOverride;
  }

  try {
    const { data, error } = await supabase.functions.invoke('submit-journal', {
      body: payload,
    });

    if (error) {
      logger.error('journal', 'submit-journal function error', undefined, error);
      return {
        ok: false,
        error: error.message || 'Submission failed. Please check network.',
        sentBlocks: summary.sent,
        totalBlocks: summary.total,
      };
    }

    // Clear draft on successful submission
    await clearJournalDraft();

    return {
      ok: true,
      entryId: data?.entry_id,
      sentBlocks: summary.sent,
      totalBlocks: summary.total,
    };
  } catch (err: any) {
    logger.error('journal', 'Exception submitting journal', undefined, err);
    return {
      ok: false,
      error: err?.message || 'Unexpected network error submitting journal.',
      sentBlocks: summary.sent,
      totalBlocks: summary.total,
    };
  }
}

/**
 * Simulates the overnight Anchor Plan generation based on journal entry content.
 * Used for instant verification in development/testing without waiting for overnight cron jobs.
 * Generates structured next-day anchors matching the anchor_plan contract.
 */
export async function simulateOvernightAnchorPlan(
  userId: string,
  planDate: string,
  journalContent: string
): Promise<StoredAnchor[]> {
  const isWorkoutMentioned = /gym|workout|run|exercise|walk|fitness/i.test(journalContent);
  const isDeepWorkMentioned = /code|build|feature|study|read|write|project|deep work/i.test(journalContent);

  const generatedAnchors: StoredAnchor[] = [
    {
      id: `sim_anchor_1_${planDate}`,
      start: '08:00',
      end: '09:00',
      label: 'Morning calibration & reflection',
      kind: 'routine',
    },
    {
      id: `sim_anchor_2_${planDate}`,
      start: '09:00',
      end: '12:00',
      label: isDeepWorkMentioned
        ? 'Deep work block: primary objective focus'
        : 'Deep focus block',
      kind: 'commitment',
    },
    {
      id: `sim_anchor_3_${planDate}`,
      start: '12:00',
      end: '13:00',
      label: 'Midday meal & recovery walk',
      kind: 'routine',
    },
    {
      id: `sim_anchor_4_${planDate}`,
      start: '14:00',
      end: '16:00',
      label: isWorkoutMentioned
        ? 'Physical training & fitness focus'
        : 'Secondary focus & execution block',
      kind: 'commitment',
    },
    {
      id: `sim_anchor_5_${planDate}`,
      start: '16:00',
      end: '17:00',
      label: 'Unstructured decompression block',
      kind: 'free_block',
    },
    {
      id: `sim_anchor_6_${planDate}`,
      start: '18:00',
      end: '18:30',
      label: 'Boredom relief & creative hobby',
      kind: 'boredom_relief',
    },
  ];

  // If user is connected to live backend, save to anchor_plans table
  if (userId) {
    try {
      await saveTodayAnchorPlan(planDate, generatedAnchors);
    } catch (err) {
      logger.warn('journal', 'Could not save simulated anchors via RPC', undefined, err);
    }
  }

  return generatedAnchors;
}
