// app/(app)/journal.tsx
// Deprecated per design/RECON.md §6 and PRD §0.
// Evening session and reflections are inline within S1 (chat) and S2 (today). Redirects to /(app)/chat.

import React from 'react';
import { Redirect } from 'expo-router';

export default function JournalScreen() {
  return <Redirect href="/(app)/chat" />;
}
