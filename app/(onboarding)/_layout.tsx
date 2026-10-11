import { Stack } from 'expo-router';
import { View, Text } from 'react-native';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="interview" />
    </Stack>
  );
}