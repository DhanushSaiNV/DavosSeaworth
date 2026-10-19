import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import { Screen, Card, Text, Button, Icon, Badge } from '../../components/ui';

export default function InterviewScreen() {
  const router = useRouter();
  const { colors, spacing } = useTheme();

  const handleStart = () => {
    router.replace('/(app)/chat');
  };

  return (
    <Screen scrollable maxWidth={540} contentContainerStyle={styles.container}>
      {/* Header Eyebrow */}
      <View style={styles.eyebrowRow}>
        <Badge label="Intake Step 1 of 3" variant="lantern" dot />
      </View>

      <Text role="display" style={styles.title}>
        Meet Your Coach
      </Text>
      <Text role="body" variant="secondary" style={styles.intro}>
        Davos is an honest, grounded life mentor designed to help you stay deliberate,
        reflect honestly, and guard your focused hours.
      </Text>

      {/* Core Principles Card */}
      <Card elevation="raised" padding={spacing.lg} style={styles.featureCard}>
        <View style={styles.featureRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.surfaceSubtle }]}>
            <Icon name="shield" size="md" color={colors.lantern} />
          </View>
          <View style={styles.featureText}>
            <Text role="bodyMedium">Uncompromising Privacy</Text>
            <Text role="caption" variant="secondary">
              Flag any journal thought Unsavable and it is stripped client-side before transmission.
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

        <View style={styles.featureRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.surfaceSubtle }]}>
            <Icon name="clock" size="md" color={colors.lantern} />
          </View>
          <View style={styles.featureText}>
            <Text role="bodyMedium">Disciplined Rhythm</Text>
            <Text role="caption" variant="secondary">
              Gentle hourly check-in windows during active hours. Completely silent while you rest.
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

        <View style={styles.featureRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.surfaceSubtle }]}>
            <Icon name="compass" size="md" color={colors.lantern} />
          </View>
          <View style={styles.featureText}>
            <Text role="bodyMedium">Adaptive Mentorship</Text>
            <Text role="caption" variant="secondary">
              Davos adjusts tone and tough-love accountability based on your real energy and vows.
            </Text>
          </View>
        </View>
      </Card>

      {/* Action Footer */}
      <View style={styles.actionContainer}>
        <Button
          title="Begin Intake Conversation"
          onPress={handleStart}
          size="lg"
          fullWidth
          iconRight={<Icon name="arrow-right" size="sm" color={colors.onAccent} />}
        />
        <Text role="caption" variant="tertiary" align="center" style={styles.durationNote}>
          Takes ~3 minutes · Shapes how Davos coaches you
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    justifyContent: 'center',
  },
  eyebrowRow: {
    marginBottom: 12,
  },
  title: {
    marginBottom: 8,
  },
  intro: {
    lineHeight: 22,
    marginBottom: 24,
  },
  featureCard: {
    marginBottom: 32,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  featureText: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  actionContainer: {
    width: '100%',
  },
  durationNote: {
    marginTop: 12,
  },
});