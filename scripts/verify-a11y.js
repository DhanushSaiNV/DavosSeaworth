// scripts/verify-a11y.js
// Accessibility Audit for Pressable & Touchable controls

const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const files = [
  'app/sign-in.tsx',
  'app/verify-code.tsx',
  'app/(onboarding)/interview.tsx',
  'app/(app)/chat.tsx',
  'app/(app)/dashboard.tsx',
  'app/(app)/journal.tsx',
  'app/(app)/settings.tsx',
  'components/ui/Button.tsx',
  'components/ui/Badge.tsx',
  'components/ui/ListItem.tsx',
];

let total = 0;
let missingRole = 0;

for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  traverse(ast, {
    JSXOpeningElement(path) {
      const name = path.node.name ? path.node.name.name : null;
      if (name === 'Pressable' || name === 'TouchableOpacity') {
        total++;
        const hasRole = path.node.attributes.some(
          (a) => a.name && a.name.name === 'accessibilityRole'
        );
        if (!hasRole) {
          missingRole++;
          console.warn(`[WARN] Missing accessibilityRole in ${f} at line ${path.node.loc.start.line}`);
        }
      }
    },
  });
}

console.log(`\nChecked ${total} Pressable/TouchableOpacity components. Missing role: ${missingRole}`);
if (missingRole > 0) {
  process.exit(1);
} else {
  console.log('ALL interactive controls have explicit accessibilityRole.');
  process.exit(0);
}
