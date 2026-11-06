// app/(app)/dashboard.tsx
// Route for direct dashboard / metrics access (TECH-SPEC §7.9; line 844; PRD §3.5, §4.5).
// Redirects canonically to /(app)/proof?tab=metrics so all proof evidence and life metrics
// live unified within Screen S3 Proof.

import React from 'react';
import { Redirect } from 'expo-router';

export default function DashboardRoute() {
  return <Redirect href="/(app)/proof?tab=metrics" />;
}
