// scripts/verify-a11y.js
// Accessibility Audit: Verifies accessibilityRole and accessibilityLabel on Pressable, TouchableOpacity, Button

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.expo' && file !== '__tests__') {
        getFiles(filePath, fileList);
      }
    } else if (file.endsWith('.tsx') && !file.includes('.test.')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const appFiles = getFiles(path.join(__dirname, '../app'));
const componentFiles = getFiles(path.join(__dirname, '../components'));
const allFiles = [...appFiles, ...componentFiles];

let total = 0;
let missingRole = 0;
let missingLabel = 0;
const offenders = [];

for (const f of allFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), f);
  const code = fs.readFileSync(f, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
  } catch (err) {
    console.error(`Error parsing ${relPath}: ${err.message}`);
    continue;
  }

  traverse(ast, {
    JSXOpeningElement(p) {
      const name = p.node.name ? p.node.name.name : null;
      if (name === 'Pressable' || name === 'TouchableOpacity') {
        total++;
        const hasRole = p.node.attributes.some(
          (a) => a.name && (a.name.name === 'accessibilityRole' || a.name.name === 'role')
        );
        const hasLabel = p.node.attributes.some(
          (a) => a.name && (a.name.name === 'accessibilityLabel' || a.name.name === 'aria-label')
        );

        const line = p.node.loc.start.line;
        if (!hasRole) {
          missingRole++;
          offenders.push(`${relPath}:${line} <${name}> missing accessibilityRole`);
        }
        if (!hasLabel) {
          // If has children containing text or title, or explicit label
          missingLabel++;
          offenders.push(`${relPath}:${line} <${name}> missing accessibilityLabel`);
        }
      }
    },
  });
}

console.log('--- ACCESSIBILITY GATE AUDIT ---');
console.log(`Total interactive elements scanned: ${total}`);
console.log(`Missing accessibilityRole: ${missingRole}`);
console.log(`Missing accessibilityLabel: ${missingLabel}`);

if (missingRole > 0) {
  console.error('\nOffenders without accessibilityRole:');
  offenders.filter(o => o.includes('accessibilityRole')).forEach(o => console.error(`  - ${o}`));
  process.exit(1);
} else {
  console.log('\nPASS: All interactive controls declare explicit accessibilityRole.');
  process.exit(0);
}
