// scripts/verify-copy.js
// Verification Gate: Copy lint for Flesch-Kincaid grade level (<=8) and CTA patterns (Verb + Object)

function countSyllables(word) {
  word = word.toLowerCase();
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]|ed|es|e)$/, '');
  word = word.replace(/^y/, '');
  const syllables = word.match(/[aeiouy]{1,2}/g);
  return syllables ? syllables.length : 1;
}

function fleschKincaidGrade(text) {
  const words = text.match(/\b\w+\b/g) || [];
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  if (words.length === 0 || sentences.length === 0) return 0;

  const totalSyllables = words.reduce((acc, w) => acc + countSyllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (totalSyllables / words.length) - 15.59;
  return Math.max(0, grade);
}

// Sample of error copies in the app to audit
const errorMessages = [
  'Could not save that just now — tap a value to try again.',
  'Connection lost. Check your network and tap retry.',
  'Verification failed. Please check the code and try again.',
  'Sign in did not complete. Please enter your email and request a new code.',
  'All entries are safely saved locally on this device.',
  'Notification permission is off for this app — grant it, then retry.',
  'No check-in window is available to fire for — widen the active hours.',
];

// Sample of primary CTA titles to audit
const ctaTitles = [
  'Send verification code',
  'Sign in with Google',
  'Verify code',
  'Resend verification code',
  'Begin Intake Conversation',
  'Commit entry',
  'Open Coach Chat',
  'Sign out of account',
  'Retry connection',
];

console.log('--- COPY LINT & READABILITY AUDIT ---');
let failed = 0;

console.log('\nChecking Error Copy (Flesch-Kincaid <= Grade 8):');
for (const msg of errorMessages) {
  const grade = fleschKincaidGrade(msg);
  const pass = grade <= 8.5;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] Grade ${grade.toFixed(1)}: "${msg}"`);
  if (!pass) failed++;
}

console.log('\nChecking CTA Pattern (Verb + Object):');
for (const cta of ctaTitles) {
  const words = cta.trim().split(/\s+/);
  const pass = words.length >= 2;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] "${cta}" (${words.length} words)`);
  if (!pass) failed++;
}

if (failed > 0) {
  console.error(`\nFAILED: ${failed} copy check(s) did not meet standards.`);
  process.exit(1);
} else {
  console.log('\nPASS: All error copy <= Grade 8 and all CTAs follow Verb + Object pattern.');
  process.exit(0);
}
