// scripts/verify-all.js
// Master Verification Suite: Runs all 14 gates defined in the autonomous redesign specification

const { execSync } = require('child_process');

const gates = [
  { name: '1. TYPECHECK', cmd: 'npm run typecheck' },
  { name: '2. TESTS', cmd: 'npm test' },
  { name: '3. LINT', cmd: 'npm run lint' },
  { name: '4. TAP_TARGET', cmd: 'node scripts/verify-tap-targets.js' },
  { name: '5. CONTRAST', cmd: 'node scripts/verify-contrast.js' },
  { name: '6. OKLCH_RAMP', cmd: 'node scripts/verify-oklch-ramp.js' },
  { name: '7. ACCESSIBILITY', cmd: 'node scripts/verify-a11y.js' },
  { name: '8. STATUS_ICON', cmd: 'node scripts/verify-status-icons.js' },
  { name: '9. BANNED_PHRASE', cmd: 'node scripts/verify-banned-phrases.js' },
  { name: '10. BANNED_TROPE', cmd: 'node scripts/verify-banned-tropes.js' },
  { name: '11. MOTION_LINT', cmd: 'node scripts/verify-motion.js' },
  { name: '12. HAPTIC_MAP', cmd: 'node scripts/verify-haptic-map.js' },
  { name: '13. COPY_LINT', cmd: 'node scripts/verify-copy.js' },
  { name: '14. DESTRUCTIVE_ACTION', cmd: 'node scripts/verify-destructive-actions.js' },
];

console.log('====================================================');
console.log('DAVOS SEAWORTH — MASTER VERIFICATION GATES (14 GATES)');
console.log('====================================================\n');

let failed = 0;
const results = [];

for (const g of gates) {
  process.stdout.write(`Running ${g.name}... `);
  try {
    execSync(g.cmd, { stdio: 'pipe' });
    console.log('PASS');
    results.push({ name: g.name, status: 'PASS' });
  } catch (err) {
    console.log('FAIL');
    console.error(`\n--- Output from ${g.name} ---\n` + (err.stdout ? err.stdout.toString() : err.message));
    results.push({ name: g.name, status: 'FAIL', error: err.message });
    failed++;
  }
}

console.log('\n====================================================');
console.log(`SUMMARY: ${gates.length - failed} of ${gates.length} GATES PASSED`);
console.log('====================================================');

if (failed > 0) {
  console.error(`\nFAILED: ${failed} verification gate(s) did not pass.`);
  process.exit(1);
} else {
  console.log('\nALL 14 VERIFICATION GATES PASSED PERFECTLY.');
  process.exit(0);
}
