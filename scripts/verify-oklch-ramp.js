// scripts/verify-oklch-ramp.js
// Verification Gate: OKLCH Monotonic Lightness Ramp Assertions

const fs = require('fs');
const path = require('path');

const colorsFile = fs.readFileSync(path.join(__dirname, '../theme/tokens/colors.ts'), 'utf8');

// Extract ramps using regex
function parseRamp(rampName) {
  const regex = new RegExp(`export const ${rampName}: OklchColor\\[\\] = \\[([\\s\\S]*?)\\];`);
  const match = colorsFile.match(regex);
  if (!match) throw new Error(`Could not find ramp ${rampName}`);
  
  const entries = match[1];
  const lMatches = [...entries.matchAll(/l:\s*([0-9.]+)/g)].map(m => parseFloat(m[1]));
  return lMatches;
}

const rampsToCheck = [
  'neutralRamp',
  'amberRamp',
  'successRamp',
  'warningRamp',
  'dangerRamp',
  'infoRamp',
];

console.log('--- OKLCH MONOTONIC LIGHTNESS VERIFICATION ---');
let failed = 0;

for (const name of rampsToCheck) {
  const lValues = parseRamp(name);
  console.log(`Checking ${name} (${lValues.length} steps): [${lValues.join(', ')}]`);
  
  for (let i = 0; i < lValues.length - 1; i++) {
    if (lValues[i] >= lValues[i + 1]) {
      console.error(`[FAIL] ${name} lightness non-monotonic at index ${i}: ${lValues[i]} >= ${lValues[i + 1]}`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`\nFAILED: ${failed} non-monotonic lightness step(s) found.`);
  process.exit(1);
} else {
  console.log(`\nPASS: All ${rampsToCheck.length} OKLCH ramps have strictly monotonic lightness.`);
  process.exit(0);
}
