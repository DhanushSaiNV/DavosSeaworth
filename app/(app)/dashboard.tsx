import { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { getGrid, loadProfileGrid } from '../../lib/checkins';
import { useTheme } from '../../theme';
import { Screen, Card, Text, Button, Icon, Badge } from '../../components/ui';

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, spacing } = useTheme();
  const [cadence, setCadence] = useState<number>(60);
  const [activeHours, setActiveHours] = useState<string>('08:00 – 22:00');

  useEffect(() => {
    if (!user) return;
    const cached = getGrid();
    if (cached) {
      setCadence(cached.cadenceMinutes);
      setActiveHours(`${cached.activeStart} – ${cached.activeEnd}`);
    } else {
      loadProfileGrid(user.id).then((g) => {
        if (g) {
          setCadence(g.cadenceMinutes);
          setActiveHours(`${g.activeStart} – ${g.activeEnd}`);
        }
      });
    }
  }, [user]);

  const currentDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date());

  return (
    <Screen scrollable maxWidth={600} contentContainerStyle={styles.container}>
      {/* Header Profile / Date */}
      <View style={styles.header}>
        <View>
          <Text role="caption" variant="tertiary" style={styles.dateLabel}>
            {currentDate}
          </Text>
          <Text role="display" style={styles.title}>
            Overview
          </Text>
        </View>
        <Badge label="Disciplined" variant="lantern" dot />
      </View>

      {/* Coach Status Banner */}
      <Card elevation="raised" padding={spacing.lg} style={styles.coachCard}>
        <View style={styles.coachRow}>
          <View style={[styles.avatarCircle, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
            <Icon name="compass" size={24} color={colors.lantern} />
          </View>
          <View style={styles.coachInfo}>
            <Text role="title" style={styles.coachName}>
              Davos
            </Text>
            <Text role="caption" variant="secondary">
              Life Mentor · Observant & Steadfast
            </Text>
          </View>
          <Button
            title="Chat"
            size="sm"
            variant="secondary"
            onPress={() => router.push('/(app)/chat')}
            icon={<Icon name="message-square" size="sm" color={colors.textPrimary} />}
          />
        </View>
      </Card>

      {/* Telemetry Metrics Grid */}
      <View style={styles.metricsRow}>
        <Card elevation="raised" padding={spacing.md} style={styles.metricCard}>
          <View style={styles.metricHeader}>
            <Icon name="clock" size="sm" color={colors.lantern} />
            <Text role="caption" variant="secondary">
              Cadence
            </Text>
          </View>
          <Text role="title" tabular style={styles.metricValue}>
            {cadence}m
          </Text>
          <Text role="caption" variant="tertiary">
            Every {cadence} minutes
          </Text>
        </Card>

        <Card elevation="raised" padding={spacing.md} style={styles.metricCard}>
          <View style={styles.metricHeader}>
            <Icon name="sun" size="sm" color={colors.lantern} />
            <Text role="caption" variant="secondary">
              Active Hours
            </Text>
          </View>
          <Text role="title" tabular style={styles.metricValue}>
            {activeHours.split(' – ')[0]}
          </Text>
          <Text role="caption" variant="tertiary">
            Until {activeHours.split(' – ')[1] ?? '22:00'}
          </Text>
        </Card>
      </View>

      {/* Doings Log Section */}
      <View style={styles.sectionHeader}>
        <Text role="title" style={styles.sectionTitle}>
          Today’s Doings & Check-ins
        </Text>
        <Text role="caption" variant="secondary">
          Tracked hourly
        </Text>
      </View>

      <Card elevation="raised" padding={spacing.lg} style={styles.doingsCard}>
        <View style={styles.emptyDoings}>
          <View style={[styles.emptyIconCircle, { backgroundColor: colors.surfaceSubtle }]}>
            <Icon name="check-circle" size={24} color={colors.textTertiary} />
          </View>
          <Text role="bodyMedium" align="center" style={styles.emptyTitle}>
            No check-ins logged yet today
          </Text>
          <Text role="caption" variant="tertiary" align="center" style={styles.emptyDesc}>
            Check-in windows trigger automatically during active hours. You can also message Davos directly anytime.
          </Text>
          <Button
            title="Open Coach Chat"
            variant="primary"
            size="md"
            onPress={() => router.push('/(app)/chat')}
            style={styles.emptyAction}
          />
        </View>
      </Card>

      {/* Journal Quick Link */}
      <Card
        elevation="raised"
        padding={spacing.md}
        style={styles.journalCard}
      >
        <View style={styles.journalRow}>
          <View style={[styles.journalIconBox, { backgroundColor: colors.lanternSurface }]}>
            <Icon name="shield" size="md" color={colors.lantern} />
          </View>
          <View style={styles.journalText}>
            <Text role="bodyMedium">Private Journal</Text>
            <Text role="caption" variant="secondary">
              Draft reflections with client-side stripped privacy
            </Text>
          </View>
          <Button
            title="Write"
            size="sm"
            variant="ghost"
            onPress={() => router.push('/(app)/journal')}
            iconRight={<Icon name="arrow-right" size="sm" color={colors.textPrimary} />}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  dateLabel: {
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    lineHeight: 32,
  },
  coachCard: {
    marginBottom: 16,
  },
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  coachInfo: {
    flex: 1,
  },
  coachName: {
    fontSize: 17,
    marginBottom: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 22,
    marginBottom: 4,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
  },
  doingsCard: {
    marginBottom: 16,
  },
  emptyDoings: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  emptyIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    marginBottom: 4,
  },
  emptyDesc: {
    maxWidth: 280,
    lineHeight: 18,
    marginBottom: 16,
  },
  emptyAction: {
    minWidth: 140,
  },
  journalCard: {
    marginTop: 4,
  },
  journalRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  journalIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  journalText: {
    flex: 1,
  },
});