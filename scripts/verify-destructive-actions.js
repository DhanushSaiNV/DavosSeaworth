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

function extractFunctionBody(code, funcName) {
  // Match various function declaration patterns and return the body
  // In template literals: \\s produces \s in the regex (whitespace class)
  const patterns = [
    // const funcName = () => { ... }
    new RegExp(`const\\s+${funcName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\}\\s*(?:;|,|$)`),
    // const funcName = function() { ... }
    new RegExp(`const\\s+${funcName}\\s*=\\s*(?:async\\s*)?function\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\}\\s*(?:;|,|$)`),
    // function funcName() { ... }
    new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\}\\s*(?:;|$)`),
    // funcName = () => { ... } (class property / bare assignment)
    new RegExp(`${funcName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\}\\s*(?:;|,|$)`),
  ];

  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match) return match[1];
  }
  return null;
}

const allFiles = [...scanDir(path.join(__dirname, '../app')), ...scanDir(path.join(__dirname, '../components'))];

console.log('--- DESTRUCTIVE ACTIONS AUDIT ---');
let audited = 0;
let violations = 0;

for (const f of allFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), f);
  const code = fs.readFileSync(f, 'utf8');
  const lines = code.split('\n');

  lines.forEach((line, idx) => {
    if (line.includes('variant="destructive"')) {
      audited++;

      // Tight context window: only the button element itself (typically 5-15 lines)
      // to avoid capturing sibling buttons' onPress handlers
      const contextStart = Math.max(0, idx - 3);
      const contextEnd = Math.min(lines.length - 1, idx + 12);
      const buttonContext = lines.slice(contextStart, contextEnd).join('\n');

      // Check 1: Label restates object (must not be bare "Delete" or "Sign out")
      const titleMatch = buttonContext.match(/title="([^"]+)"/);
      if (titleMatch) {
        const title = titleMatch[1];
        const words = title.trim().split(/\s+/);
        if (words.length < 2) {
          console.error(`[FAIL] ${relPath}:${idx + 1} Destructive CTA "${title}" does not restate object (single word).`);
          violations++;
        }
      }

      // Check 2: Confirm dialog or undo within THIS button's onPress handler
      let hasConfirmOrUndo = false;

      // Find onPress in the button context
      const onPressMatch = buttonContext.match(/onPress=\s*\{([^}]+)\}/);
      if (onPressMatch) {
        const handlerExpr = onPressMatch[1].trim();

        // Direct inline handler with Alert.alert or confirm
        if (handlerExpr.includes('Alert.alert') || handlerExpr.includes('confirm(')) {
          hasConfirmOrUndo = true;
        }

        // Handler calls a named function OR references a function
        // Match both funcName() and bare funcName
        const funcMatch = handlerExpr.match(/(\w+)\s*\(/) || handlerExpr.match(/^(\w+)$/);
        if (!hasConfirmOrUndo && funcMatch) {
          const funcName = funcMatch[1];
          const funcBody = extractFunctionBody(code, funcName);
          if (funcBody) {
            if (funcBody.includes('Alert.alert') || funcBody.includes('confirm(') ||
                funcBody.includes('undo') || funcBody.includes('Undo')) {
              hasConfirmOrUndo = true;
            }
          }
        }
      }

      if (!hasConfirmOrUndo) {
        console.error(`[FAIL] ${relPath}:${idx + 1} Destructive action lacks confirmation dialog or undo in its onPress handler.`);
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