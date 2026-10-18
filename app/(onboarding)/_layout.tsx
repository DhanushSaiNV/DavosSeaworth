import { Stack } from 'expo-router';
import { useTheme } from '../../theme';

export default function OnboardingLayout() {
  const { colors } = useTheme();

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