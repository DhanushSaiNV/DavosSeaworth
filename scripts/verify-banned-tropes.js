// scripts/verify-banned-tropes.js
// Verification Gate: Scans for banned decorative tropes (confetti, BlurView in content, withRepeat outside media)

const fs = require('fs');
const path = require('path');

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

console.log('--- BANNED TROPES GATE SCAN ---');
let violations = 0;

for (const f of allFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), f);
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    // Ignore comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

    // 1. Confetti
    if (/\bconfetti\b/i.test(line)) {
      console.error(`[FAIL] ${relPath}:${idx + 1} Confetti is banned.`);
      violations++;
    }

    // 2. withRepeat / Animated.loop in non-media files
    if (/\b(withRepeat|Animated\.loop)\b/.test(line)) {
      console.error(`[FAIL] ${relPath}:${idx + 1} Looping animations (withRepeat/Animated.loop) banned in non-media.`);
      violations++;
    }

    // 3. BlurView / glass in non-navigation files
    if (/\b(BlurView|experimental_useGlassEffect|backdropBlur)\b/.test(line)) {
      if (!relPath.includes('_layout') && !relPath.includes('TabBar')) {
        console.error(`[FAIL] ${relPath}:${idx + 1} BlurView/glass materials restricted strictly to navigation layer.`);
        violations++;
      }
    }

    // 4. Bouncing dot / chatbot pulsing animations
    if (/\b(bouncingDot|pulseBubble|bounceAnimation|pulsingDot)\b/i.test(line)) {
      console.error(`[FAIL] ${relPath}:${idx + 1} Bouncing dots and pulsing bubbles are banned.`);
      violations++;
    }
  });
}

if (violations > 0) {
  console.error(`\nFAILED: Found ${violations} banned trope violation(s).`);
  process.exit(1);
} else {
  console.log('PASS: Zero banned tropes (confetti, glass in content, looping animations) found.');
  process.exit(0);
}
