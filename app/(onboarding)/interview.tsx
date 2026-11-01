// app/(onboarding)/interview.tsx
// Deprecated per design/RECON.md §6 and PRD §0.
// Onboarding conversation lives in S1 Thread first-run. Redirects to /(app)/chat.

import React from 'react';
import { Redirect } from 'expo-router';

export default function InterviewScreen() {
  return <Redirect href="/(app)/chat" />;
}
