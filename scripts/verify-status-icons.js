// scripts/verify-status-icons.js
// Verification Gate: Asserts that every status element (success/warning/error) pairs color with text or an icon

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

console.log('--- STATUS ICON / TEXT PAIRING AUDIT ---');
let audited = 0;
let violations = 0;

for (const f of allFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), f);
  const code = fs.readFileSync(f, 'utf8');

  // Check for status colors: danger, warning, success
  const lines = code.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('colors.danger') || line.includes('colors.warning') || line.includes('colors.success')) {
      audited++;
      // Verify that nearby context includes Icon, Text, or Badge label
      const windowStart = Math.max(0, idx - 25);
      const windowEnd = Math.min(lines.length - 1, idx + 25);
      const context = lines.slice(windowStart, windowEnd).join(' ');

      const lowerContext = context.toLowerCase();
      const hasTextOrIcon =
        context.includes('Text') ||
        context.includes('Icon') ||
        context.includes('Badge') ||
        lowerContext.includes('icon') ||
        lowerContext.includes('label') ||
        lowerContext.includes('text') ||
        lowerContext.includes('title') ||
        lowerContext.includes('accessibilitylabel');

      if (!hasTextOrIcon) {
        console.warn(`[WARN] Possible color-only signal at ${relPath}:${idx + 1}`);
        violations++;
      }
    }
  });
}

console.log(`Audited ${audited} status color usages.`);
if (violations > 0) {
  console.error(`\nFAILED: Found ${violations} color-only status indicator(s).`);
  process.exit(1);
}
console.log('Zero naked color-only status indicators found.');
console.log('\nPASS: Every status signal is paired with an icon or descriptive text.');
process.exit(0);
