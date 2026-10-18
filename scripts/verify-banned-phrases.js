// scripts/verify-banned-phrases.js
// Verification Gate: Scans user-facing UI files for banned generic error phrases

const fs = require('fs');
const path = require('path');

const bannedPatterns = [
  /\bOops\b/i,
  /\bSomething went wrong\b/i,
  /\bInvalid\b(?!\s+(?:input|email|code|number|cadence|hours)\b)/i, // Banned if bare without consequence
];

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

const appFiles = scanDir(path.join(__dirname, '../app'));
const componentFiles = scanDir(path.join(__dirname, '../components'));
const allFiles = [...appFiles, ...componentFiles];

console.log('--- BANNED PHRASES GATE SCAN ---');
let violations = 0;

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    // Ignore comments
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) return;

    for (const pattern of bannedPatterns) {
      if (pattern.test(line)) {
        console.error(`[FAIL] ${path.relative(path.join(__dirname, '..'), f)}:${idx + 1}: Banned phrase matching ${pattern}`);
        console.error(`       Line: "${line.trim()}"`);
        violations++;
      }
    }
  });
}

if (violations > 0) {
  console.error(`\nFAILED: Found ${violations} banned phrase violation(s).`);
  process.exit(1);
} else {
  console.log('PASS: Zero banned generic error phrases found across UI code.');
  process.exit(0);
}
