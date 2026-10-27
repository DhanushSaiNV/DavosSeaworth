import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { loadConfig } from '../../lib/config';
import { loadDevOverrides } from '../../lib/devOverrides';
import { useTheme } from '../../theme';

export default function OnboardingLayout() {
  const { colors } = useTheme();

  // The intake route does not mount the `(app)` tab shell, so it loads the runtime config
  // itself (AGENTS.md §2: [SPEC] values come from `config`, never defaults). The dev tier
  // forcer is a no-op in production and is loaded for the same reason.
  useEffect(() => {
    void loadConfig();
    void loadDevOverrides();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="interview" />
    </Stack>
  );
}
