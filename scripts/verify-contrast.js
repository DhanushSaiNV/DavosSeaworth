// scripts/verify-contrast.js
// WCAG 2.1 Contrast Ratio calculation and verification script

function srgbToLinear(c) {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex) {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(hex1, hex2) {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Light & Dark theme tokens to verify
const pairs = [
  // Light Mode
  { name: 'Light textPrimary on background', fg: '#0F1117', bg: '#F8F9FA', min: 4.5 },
  { name: 'Light textPrimary on surface', fg: '#0F1117', bg: '#FFFFFF', min: 4.5 },
  { name: 'Light textSecondary on background', fg: '#525866', bg: '#F8F9FA', min: 4.5 },
  { name: 'Light textSecondary on surface', fg: '#525866', bg: '#FFFFFF', min: 4.5 },
  { name: 'Light onAccent on accent', fg: '#FFFFFF', bg: '#0F1117', min: 4.5 },
  { name: 'Light danger on surface', fg: '#DC2626', bg: '#FFFFFF', min: 4.5 },
  { name: 'Light dangerText on dangerSurface', fg: '#B91C1C', bg: '#FEF2F2', min: 4.5 },
  { name: 'Light success on surface', fg: '#047857', bg: '#FFFFFF', min: 4.5 },
  { name: 'Light info on surface', fg: '#2563EB', bg: '#FFFFFF', min: 4.5 },
  { name: 'Light border on surface (UI boundary)', fg: '#8B929C', bg: '#FFFFFF', min: 3 },

  // Dark Mode
  { name: 'Dark textPrimary on background', fg: '#F9FAFB', bg: '#090A0F', min: 4.5 },
  { name: 'Dark textPrimary on surface', fg: '#F9FAFB', bg: '#12151E', min: 4.5 },
  { name: 'Dark textSecondary on background', fg: '#9CA3AF', bg: '#090A0F', min: 4.5 },
  { name: 'Dark textSecondary on surface', fg: '#9CA3AF', bg: '#12151E', min: 4.5 },
  { name: 'Dark onAccent on accent', fg: '#090A0F', bg: '#F9FAFB', min: 4.5 },
  { name: 'Dark danger on background', fg: '#EF4444', bg: '#090A0F', min: 4.5 },
  { name: 'Dark danger on surface', fg: '#EF4444', bg: '#12151E', min: 4.5 },
  { name: 'Dark success on background', fg: '#10B981', bg: '#090A0F', min: 4.5 },
  { name: 'Dark success on surface', fg: '#10B981', bg: '#12151E', min: 4.5 },
  { name: 'Dark info on background', fg: '#3B82F6', bg: '#090A0F', min: 4.5 },
  { name: 'Dark lantern on background', fg: '#F59E0B', bg: '#090A0F', min: 4.5 },
];

let failed = 0;
console.log('--- WCAG 2.1 CONTRAST VERIFICATION ---');
for (const p of pairs) {
  const ratio = contrast(p.fg, p.bg);
  const ok = ratio >= p.min;
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${p.name}: ${ratio.toFixed(2)}:1 (required >= ${p.min}:1)`);
  if (!ok) failed++;
}

if (failed > 0) {
  console.error(`\nFAILED: ${failed} contrast check(s) did not meet WCAG threshold.`);
  process.exit(1);
} else {
  console.log(`\nALL ${pairs.length} CONTRAST CHECKS PASSED WCAG 2.1 REQUIREMENTS.`);
  process.exit(0);
}
