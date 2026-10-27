import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ChatScreen } from '../(app)/chat';

/**
 * FP-09 FR-9 — the interview is the standing chat thread in `interview` mode: the same
 * Realtime/composer/optimistic/offline machinery, no tab bar, no check-in or impulse
 * surfaces, plus the five-step indicator. Completion (a `select-metrics` response or a
 * focus-time profile read) replaces the route with the app thread.
 */
export default function InterviewScreen() {
  const router = useRouter();
  const onComplete = useCallback(() => {
    router.replace('/(app)/chat');
  }, [router]);

  return <ChatScreen mode="interview" onComplete={onComplete} />;
}
