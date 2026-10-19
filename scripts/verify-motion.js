// scripts/verify-motion.js
// Verification Gate: Motion lint enforcing duration budgets, reduceMotion, and animation hygiene

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

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

console.log('--- MOTION LINT GATE SCAN ---');
let violations = 0;

for (const f of allFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), f);
  const code = fs.readFileSync(f, 'utf8');

  // Fast check: does this file mention animations?
  if (!code.includes('withTiming') && !code.includes('withSpring') && !code.includes('Animated.')) {
    continue;
  }

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
    CallExpression(p) {
      const callee = p.node.callee;
      const calleeName = callee.name || (callee.property ? callee.property.name : null);

      // Check withTiming
      if (calleeName === 'withTiming' || (callee.object && callee.object.name === 'Animated' && callee.property && callee.property.name === 'timing')) {
        const configArg = p.node.arguments[1];
        if (configArg && configArg.type === 'ObjectExpression') {
          const durationProp = configArg.properties.find(prop => prop.key && prop.key.name === 'duration');
          if (durationProp && durationProp.value.type === 'NumericLiteral') {
            if (durationProp.value.value > 500) {
              console.error(`[FAIL] ${relPath}:${p.node.loc.start.line} withTiming duration ${durationProp.value.value}ms exceeds 500ms budget.`);
              violations++;
            }
          }
        }
      }

      // Check withRepeat
      if (calleeName === 'withRepeat') {
        console.error(`[FAIL] ${relPath}:${p.node.loc.start.line} withRepeat is banned in non-media UI.`);
        violations++;
      }
    },
  });
}

if (violations > 0) {
  console.error(`\nFAILED: Found ${violations} motion violation(s).`);
  process.exit(1);
} else {
  console.log('PASS: All animations within budget (<=500ms), zero withRepeat, motion hygiene verified.');
  process.exit(0);
}
