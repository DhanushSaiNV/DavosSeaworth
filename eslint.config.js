const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    rules: {
      'no-console': 'warn',
    },
  },
  {
    ignores: ['node_modules/', 'supabase/functions/'],
  },
];
