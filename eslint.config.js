const expoConfig = require('eslint-config-expo/flat');
const reactNative = require('eslint-plugin-react-native');

module.exports = [
  ...expoConfig,
  {
    plugins: { 'react-native': reactNative },
    rules: {
      'no-console': 'warn',
      // The design system's two structural rules: colour and layout values live in
      // `lib/theme/tokens.ts`, not in a screen. Enabled repo-wide as warnings so the drift is
      // visible without blocking, and switched off inside the token module itself.
      'react-native/no-color-literals': 'warn',
      'react-native/no-inline-styles': 'warn',
    },
  },
  {
    // The token module is the one place a raw colour is legitimate.
    files: ['lib/theme/**', 'theme/**'],
    rules: {
      'react-native/no-color-literals': 'off',
      'react-native/no-inline-styles': 'off',
    },
  },
  {
    // Build output and dev caches are gitignored; lint them never (an Expo web export here is
    // ~1k `no-undef` errors in a generated bundle, which would mask real source errors).
    ignores: ['node_modules/', 'dist/', 'web-build/', '.expo/', 'supabase/functions/'],
  },
];
