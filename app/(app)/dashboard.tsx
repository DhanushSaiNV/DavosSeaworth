import { useState, useEffect, useCallback, useRef } from 'react';
import { useWindowDimensions, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { getGrid, loadProfileGrid } from '../../lib/checkins';
import { requireConfigNumber, useConfig } from '../../lib/config';
import { logger } from '../../lib/logger';
import { supabase } from '../../lib/supabase';
import {
  buildMetricViews,
  formatMetricDelta,
  formatMetricNumber,
  trailingStartDate,
  type DashboardMetricRow,
  type MetricPointRow,
  type MetricView,
} from '../../lib/metricsData';
import { useTheme } from '../../theme';
import { BrandMark } from '../../components/brand';
import {
  Screen,
  Card,
  Text,
  Button,
  Icon,
  PageHeader,
  IconButton,
  EmptyState,
  LoadingMark,
  SegmentedControl,
} from '../../components/ui';
import {
  ConsistencyHeatmap,
  ProgressBar,
  StatCard,
  TrendLineGraph,
} from '../../components/metrics';

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

  const { status: configStatus } = useConfig();
  const [metricViews, setMetricViews] = useState<MetricView[]>([]);
  const [metricsLoaded, setMetricsLoaded] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [heatmapByMetric, setHeatmapByMetric] = useState<Record<string, boolean>>({});
  const [metricsUserId, setMetricsUserId] = useState<string | null | undefined>(user?.id);
  const metricsRequestRef = useRef(0);

  const loadMetrics = useCallback(async () => {
    if (!user || configStatus !== 'loaded') return;
    const requestId = ++metricsRequestRef.current;

    let historyDays: number;
    try {
      historyDays = requireConfigNumber('metric_history_days');
    } catch (err) {
      if (requestId !== metricsRequestRef.current) return;
      setMetricsLoading(false);
      setMetricsLoaded(true);
      setMetricsError('Metric history is unavailable.');
      logger.warn('app', 'metric history config unavailable', { key: 'metric_history_days' }, err);
      return;
    }

    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const { data: metricRows, error: metricQueryError } = await supabase
        .from('metrics')
        .select(
          'id,name,domain,output_unit,is_quest,quest_status,quest_deadline,created_at,formula_status,archived_at'
        )
        .eq('user_id', user.id)
        .eq('formula_status', 'validated')
        .is('archived_at', null)
        .order('created_at', { ascending: true });
      if (metricQueryError) throw new Error(metricQueryError.message);

      const metrics = (metricRows ?? []) as DashboardMetricRow[];
      let pointRows: MetricPointRow[] = [];
      if (metrics.length > 0) {
        const start = trailingStartDate(new Date(), historyDays);
        const { data: pointData, error: pointQueryError } = await supabase
          .from('metric_points')
          .select('metric_id,value,computed_for')
          .in(
            'metric_id',
            metrics.map((metric) => metric.id)
          )
          .gte('computed_for', start)
          .order('computed_for', { ascending: true });
        if (pointQueryError) throw new Error(pointQueryError.message);
        pointRows = (pointData ?? []) as MetricPointRow[];
      }

      if (requestId !== metricsRequestRef.current) return;
      const views = buildMetricViews(metrics, pointRows, historyDays);
      setMetricViews(views);
      setMetricsLoaded(true);
      logger.info('app', 'metrics loaded', {
        metrics: views.length,
        points: pointRows.length,
        historyDays,
      });
    } catch (err) {
      if (requestId !== metricsRequestRef.current) return;
      setMetricsLoaded(true);
      setMetricsError(err instanceof Error ? err.message : String(err));
      logger.error('app', 'metrics load failed', { userId: user.id }, err);
    } finally {
      if (requestId === metricsRequestRef.current) setMetricsLoading(false);
    }
  }, [user, configStatus]);

  // Never show one account's chart state after the signed-in user changes. This runs during
  // render, before the focus loader can start the new user's read (React's prop-change reset
  // pattern). The extra render is immediate and does not commit the stale account's state.
  if (metricsUserId !== user?.id) {
    setMetricsUserId(user?.id);
    setMetricViews([]);
    setMetricsLoaded(false);
    setMetricsError(null);
    setHeatmapByMetric({});
  }

  useFocusEffect(
    useCallback(() => {
      void loadMetrics();
      return () => {
        // Invalidate any in-flight read on blur so it cannot set state after the screen leaves.
        metricsRequestRef.current += 1;
      };
    }, [loadMetrics])
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const apply = (g: { cadenceMinutes: number; activeStart: string; activeEnd: string } | null) => {
      if (cancelled || !g) return;
      setCadence(g.cadenceMinutes);
      setActiveHours(`${g.activeStart} – ${g.activeEnd}`);
      setLoaded(true);
    };
    const cached = getGrid();
    if (cached) {
      apply(cached);
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

  const renderMetricBody = (view: MetricView) => {
    if (view.kind === 'progress') {
      return (
        <ProgressBar
          metric_id={view.metric.id}
          points={view.series.points}
          progress={view.progress}
        />
      );
    }

    if (view.kind === 'trend') {
      const showHeatmap = heatmapByMetric[view.metric.id] === true;
      return (
        <View>
          {view.heatmapAvailable ? (
            <View style={styles.metricToggle}>
              <SegmentedControl
                options={[
                  { value: 'trend', label: 'Trend' },
                  { value: 'heatmap', label: 'Heatmap' },
                ]}
                value={showHeatmap ? 'heatmap' : 'trend'}
                onChange={(mode) =>
                  setHeatmapByMetric((previous) => ({
                    ...previous,
                    [view.metric.id]: mode === 'heatmap',
                  }))
                }
              />
            </View>
          ) : null}
          <View style={styles.metricChart}>
            {showHeatmap ? (
              <ConsistencyHeatmap metric_id={view.metric.id} points={view.series.points} />
            ) : (
              <TrendLineGraph metric_id={view.metric.id} points={view.series.points} />
            )}
          </View>
        </View>
      );
    }

    return <StatCard metric_id={view.metric.id} points={view.series.points} />;
  };

  const trackedMetricCard = (view: MetricView) => {
    const deltaLabel =
      view.kind === 'progress'
        ? view.metric.quest_status === 'completed'
          ? 'Completed'
          : view.progress >= 1
            ? 'Window elapsed'
            : `${Math.round(view.progress * 100)}% elapsed`
        : view.delta === null
          ? 'No prior day'
          : `${formatMetricDelta(view.delta)} vs prior day`;

    return (
      <Card
        key={view.metric.id}
        elevation="raised"
        padding={spacing.md}
        style={styles.trackedMetricCard}
      >
        <View style={styles.trackedMetricHeader}>
          <View style={styles.trackedMetricName}>
            <Text role="bodyStrong" numberOfLines={1}>
              {view.metric.name}
            </Text>
            <Text role="caption" variant="tertiary" numberOfLines={1}>
              {view.metric.domain ?? 'General'}
            </Text>
          </View>
          <View style={styles.trackedMetricReading}>
            <Text role="title" tabular>
              {formatMetricNumber(view.latest)}
            </Text>
            {view.metric.output_unit ? (
              <Text role="caption" variant="secondary">
                {view.metric.output_unit}
              </Text>
            ) : null}
          </View>
        </View>

        <Text role="caption" variant="secondary" style={styles.metricDelta}>
          {deltaLabel}
        </Text>

        <View style={styles.metricBody}>{renderMetricBody(view)}</View>
      </Card>
    );
  };

  const trackedMetricsSection = (
    <View style={styles.trackedMetricsSection}>
      <View style={styles.trackedMetricsHeader}>
        <Text role="title" style={styles.sectionTitle}>
          Metrics
        </Text>
        <IconButton
          icon="refresh-cw"
          accessibilityLabel="Refresh metrics"
          size="sm"
          variant="ghost"
          loading={metricsLoading}
          disabled={!user || configStatus !== 'loaded'}
          onPress={() => {
            void loadMetrics();
          }}
        />
      </View>

      {configStatus === 'error' ? (
        <Card elevation="raised" padding={spacing.md}>
          <View style={styles.metricsNotice}>
            <Icon name="alert-circle" size="md" color={colors.danger} />
            <Text role="bodyMedium" align="center" style={styles.metricsNoticeTitle}>
              Metrics are unavailable
            </Text>
            <Text role="caption" variant="tertiary" align="center">
              The app configuration could not be loaded.
            </Text>
          </View>
        </Card>
      ) : metricsLoading && metricViews.length === 0 ? (
        <Card elevation="raised" padding={spacing.md}>
          <View style={styles.metricsLoading}>
            <LoadingMark size="small" label="Loading metrics" />
            <Text role="caption" variant="tertiary">
              Loading metrics…
            </Text>
          </View>
        </Card>
      ) : metricViews.length > 0 ? (
        <View style={styles.trackedMetricList}>
          {metricViews.map((view) => trackedMetricCard(view))}
        </View>
      ) : metricsError ? (
        <Card elevation="raised" padding={spacing.xs}>
          <EmptyState
            title="Metrics unavailable"
            description="The dashboard could not read your metrics. Try again."
            iconName="alert-circle"
            actionTitle="Retry"
            onAction={() => {
              void loadMetrics();
            }}
          />
        </Card>
      ) : metricsLoaded ? (
        <Card elevation="raised" padding={spacing.xs}>
          <EmptyState
            title="No metrics yet"
            description="Metrics appear here after a full day of check-ins and doings."
            iconName="activity"
          />
        </Card>
      ) : (
        <Card elevation="raised" padding={spacing.md}>
          <View style={styles.metricsLoading}>
            <LoadingMark size="small" label="Loading metrics" />
            <Text role="caption" variant="tertiary">
              Loading metrics…
            </Text>
          </View>
        </Card>
      )}
    </View>
  );

  const coachSection = (
    <Card elevation="raised" padding={spacing.lg} style={styles.coachCard}>
      <View style={styles.coachRow}>
        <View style={styles.coachLogoWrapper}>
          <BrandMark size={32} decorative />
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

  const cadenceSection = (
    <View style={styles.metricsRow}>
      <Card elevation="raised" padding={spacing.md} style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Icon name="clock" size="sm" color={colors.textTertiary} />
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
          <Icon name="sun" size="sm" color={colors.textTertiary} />
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
            {trackedMetricsSection}
            {doingsSection}
          </View>
          <View style={styles.sideColumn}>
            {cadenceSection}
            {journalSection}
          </View>
        </View>
      ) : (
        <View>
          {coachSection}
          {cadenceSection}
          {trackedMetricsSection}
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
  coachLogoWrapper: {
    marginRight: 14,
    justifyContent: 'center',
    alignItems: 'center',
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
  trackedMetricsSection: {
    marginBottom: 24,
  },
  trackedMetricsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  trackedMetricList: {
    gap: 16,
  },
  trackedMetricCard: {
    marginBottom: 0,
  },
  trackedMetricHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  trackedMetricName: {
    flex: 1,
    minWidth: 0,
  },
  trackedMetricReading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  metricDelta: {
    marginTop: 2,
  },
  metricBody: {
    marginTop: 4,
  },
  metricToggle: {
    marginTop: 12,
    marginBottom: 12,
  },
  metricChart: {
    marginTop: 12,
  },
  metricsNotice: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  metricsNoticeTitle: {
    marginTop: 8,
    marginBottom: 4,
  },
  metricsLoading: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
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
