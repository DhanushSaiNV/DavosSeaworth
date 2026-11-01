// app/(app)/dashboard.tsx
// Deprecated per design/RECON.md §6 and PRD §0.
// S3 Proof is the canonical evidence place. Redirects to /(app)/proof.

import React from 'react';
import { Redirect } from 'expo-router';

export default function DashboardScreen() {
  return <Redirect href="/(app)/proof" />;
}
