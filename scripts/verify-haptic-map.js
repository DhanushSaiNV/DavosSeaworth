// scripts/verify-haptic-map.js
// Verification Gate: Haptic Call Site Registry and Hygiene Verification

const fs = require('fs');
const path = require('path');

const hapticsDoc = fs.readFileSync(path.join(__dirname, '../haptics.md'), 'utf8');

function scanDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.expo' && file !== '__tests__') {
        scanDir(filePath, fileList);
      }
    } else if ((file.endsWith('.tsx') || file.endsWith('.ts')) && !file.includes('.test.')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = [...scanDir(path.join(__dirname, '../app')), ...scanDir(path.join(__dirname, '../components'))];

console.log('--- HAPTIC CALL SITE MAPPING AUDIT ---');
let violations = 0;
let callSites = 0;

for (const f of allFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/');
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');

  // Check 1: Direct expo-haptics import outside lib/haptics.ts
  if (content.includes("from 'expo-haptics'") || content.includes('from "expo-haptics"')) {
    console.error(`[FAIL] ${relPath} directly imports expo-haptics. All haptic calls must use lib/haptics wrapper.`);
    violations++;
  }

  // Check 2: All haptic calls must be registered in haptics.md
  lines.forEach((line, idx) => {
    if (/\bhaptic(Selection|ImpactLight|ImpactMedium|NotifySuccess|NotifyWarning|NotifyError)\b/.test(line)) {
      // Ignore import lines
      if (line.includes('import {') || line.includes('import type')) return;
      
      callSites++;
      // Check if file is registered in haptics.md
      if (!hapticsDoc.includes(relPath)) {
        console.error(`[FAIL] ${relPath}:${idx + 1} Haptic call site is not documented in haptics.md.`);
        violations++;
      }

      // Check 3: Banned call sites (scroll, keystroke, auto-save)
      if (/onScroll|onChangeText|onKeyPress|onKeyDown/.test(line)) {
        console.error(`[FAIL] ${relPath}:${idx + 1} Haptics banned on scroll/keystrokes.`);
        violations++;
      }
    }
  });
}

console.log(`Audited ${callSites} active haptic call site(s).`);

if (violations > 0) {
  console.error(`\nFAILED: Found ${violations} haptic mapping violation(s).`);
  process.exit(1);
} else {
  console.log('PASS: All haptic call sites are properly wrapped, mapped in haptics.md, and free of banned triggers.');
  process.exit(0);
}
