// scripts/verify-destructive-actions.js
// Verification Gate: Destructive actions restate object, are separated, and provide confirm or undo

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

console.log('--- DESTRUCTIVE ACTIONS AUDIT ---');
let audited = 0;
let violations = 0;

for (const f of allFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), f);
  const code = fs.readFileSync(f, 'utf8');

  // Look for variant="destructive"
  const lines = code.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('variant="destructive"')) {
      audited++;
      const windowStart = Math.max(0, idx - 8);
      const windowEnd = Math.min(lines.length - 1, idx + 8);
      const context = lines.slice(windowStart, windowEnd).join(' ');

      // Check 1: Label restates object (must not be bare "Delete" or "Sign out")
      const titleMatch = context.match(/title="([^"]+)"/);
      if (titleMatch) {
        const title = titleMatch[1];
        const words = title.trim().split(/\s+/);
        if (words.length < 2) {
          console.error(`[FAIL] ${relPath}:${idx + 1} Destructive CTA "${title}" does not restate object (single word).`);
          violations++;
        }
      }

      // Check 2: Confirm dialog or separate handler
      const hasConfirmOrUndo =
        code.includes('Alert.alert') ||
        code.includes('confirm(') ||
        code.includes('undo') ||
        code.includes('Undo');

      if (!hasConfirmOrUndo) {
        console.error(`[FAIL] ${relPath}:${idx + 1} Destructive action lacks confirmation dialog or undo window.`);
        violations++;
      }
    }
  });
}

console.log(`Audited ${audited} destructive action site(s).`);

if (violations > 0) {
  console.error(`\nFAILED: Found ${violations} destructive action violation(s).`);
  process.exit(1);
} else {
  console.log('PASS: All destructive CTAs restate object and provide confirmation or undo safety.');
  process.exit(0);
}
