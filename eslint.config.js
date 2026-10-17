const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    rules: {
      'no-console': 'warn',
    },
  },
  {
    // Build output and dev caches are gitignored; lint them never (an Expo web export here is
    // ~1k `no-undef` errors in a generated bundle, which would mask real source errors).
    ignores: ['node_modules/', 'dist/', 'web-build/', '.expo/', 'supabase/functions/'],
  },
];
