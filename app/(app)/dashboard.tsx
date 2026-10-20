import { useState, useEffect } from 'react';
import { useWindowDimensions, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { getGrid, loadProfileGrid } from '../../lib/checkins';
import { useTheme } from '../../theme';
import { Screen, Card, Text, Button, Icon, PageHeader } from '../../components/ui';

function formatClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return value;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${match[2]} ${suffix}`;
}

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, spacing } = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 960;
  // `null` means "not loaded yet" — the dashboard must never present a default cadence or
  // active-hours window as if the user had chosen it (the values come from the profile read).
  const [cadence, setCadence] = useState<number | null>(null);
  const [activeHours, setActiveHours] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const apply = (g: { cadenceMinutes: number; activeStart: string; activeEnd: string } | null) => {
      if (cancelled || !g) return;
      setCadence(g.cadenceMinutes);
      setActiveHours(`${g.activeStart} – ${g.activeEnd}`);
    };
    const cached = getGrid();
    if (cached) {
      apply(cached);
      setLoaded(true);
      return;
    }
    loadProfileGrid(user.id)
      .then((g) => { apply(g); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [user]);

  const currentDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date());
  const activeStart = activeHours ? formatClock(activeHours.split(' – ')[0]) : null;
  const activeEnd = activeHours ? formatClock(activeHours.split(' – ')[1]) : null;

  const coachSection = (
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
  );

  const metricsSection = (
    <View style={styles.metricsRow}>
      <Card elevation="raised" padding={spacing.md} style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Icon name="clock" size="sm" color={colors.lantern} />
          <Text role="caption" variant="secondary">
            Cadence
          </Text>
        </View>
        <Text role="title" tabular style={styles.metricValue}>
          {cadence !== null ? `${cadence}m` : '—'}
        </Text>
        <Text role="caption" variant="tertiary">
          {cadence !== null ? `Every ${cadence} minutes` : loaded ? 'Not available' : 'Loading…'}
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
          {activeStart ?? '—'}
        </Text>
        <Text role="caption" variant="tertiary">
          {activeEnd
            ? `Until ${activeEnd}`
            : loaded
              ? 'Not available'
              : 'Loading…'}
        </Text>
      </Card>
    </View>
  );

  const doingsSection = (
    <View style={styles.doingsSection}>
      <View style={styles.sectionHeader}>
        <Text role="title" style={styles.sectionTitle}>
          Today&apos;s Doings & Check-ins
        </Text>
        <Text role="caption" variant="secondary">
          Tracked automatically
        </Text>
      </View>

      <Card elevation="raised" padding={spacing.lg} style={styles.doingsCard}>
        <View style={styles.emptyDoings}>
          <View style={[styles.emptyIconCircle, { backgroundColor: colors.surfaceSubtle }]}>
            <Icon name="check-circle" size={24} color={colors.textTertiary} />
          </View>
          <Text role="bodyMedium" align="center" style={styles.emptyTitle}>
            Your check-ins appear here
          </Text>
          <Text role="caption" variant="tertiary" align="center" style={styles.emptyDesc}>
            Davos logs a check-in each window during your active hours. You can also message Davos directly at any time.
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
    </View>
  );

  const journalSection = (
    <Card elevation="raised" padding={spacing.md} style={styles.journalCard}>
      <View style={styles.journalRow}>
        <View style={[styles.journalIconBox, { backgroundColor: colors.lanternSurface }]}>
          <Icon name="shield" size="md" color={colors.lantern} />
        </View>
        <View style={styles.journalText}>
          <Text role="bodyMedium">Private Journal</Text>
          <Text role="caption" variant="secondary">
            Private reflections, stripped on this device
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
  );

  return (
    <Screen
      scrollable
      maxWidth={isWide ? 1040 : 600}
      contentContainerStyle={[styles.container, isWide && styles.containerWide]}
    >
      <PageHeader
        eyebrow={currentDate}
        title="Overview"
        subtitle="Your day, at a glance."
      />

      {isWide ? (
        <View style={styles.columns}>
          <View style={styles.mainColumn}>
            {coachSection}
            {doingsSection}
          </View>
          <View style={styles.sideColumn}>
            {metricsSection}
            {journalSection}
          </View>
        </View>
      ) : (
        <View>
          {coachSection}
          {metricsSection}
          {doingsSection}
          {journalSection}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  containerWide: {
    paddingHorizontal: 32,
    paddingTop: 32,
    paddingBottom: 56,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
  },
  mainColumn: {
    flex: 1.5,
    minWidth: 0,
  },
  sideColumn: {
    flex: 1,
    minWidth: 0,
  },
  coachCard: {
    marginBottom: 24,
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
  doingsSection: {
    marginBottom: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 17,
  },
  doingsCard: {
    marginBottom: 0,
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
    maxWidth: 320,
    lineHeight: 18,
    marginBottom: 16,
  },
  emptyAction: {
    minWidth: 140,
  },
  journalCard: {
    marginTop: 0,
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
