// components/davos/__tests__/MetricsPanel.test.tsx
// Unit tests for MetricsPanel canonical component.

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../ui/LoadingMark', () => ({
  LoadingMark: () => null,
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { MetricsPanel } from '../MetricsPanel';
import type { MetricView } from '../../../lib/metricsData';

jest.setTimeout(30000);

describe('MetricsPanel Component', () => {
  it('renders loading state when isLoading is true and no views exist', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<MetricsPanel views={[]} isLoading={true} />);
    });
    const root = tree!.root;
    const textNodes = root.findAll((n) => n.props?.children === 'Loading life metrics…');
    expect(textNodes.length).toBeGreaterThan(0);
  });

  it('renders empty state with preset catalog toggle when views are empty', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<MetricsPanel views={[]} isLoading={false} />);
    });
    const root = tree!.root;
    const emptyTitle = root.findAll((n) => n.props?.children === 'No active metrics yet');
    expect(emptyTitle.length).toBeGreaterThan(0);

    const catalogToggle = root.find(
      (n) => n.props?.accessibilityLabel === 'Browse available core metric presets'
    );
    expect(catalogToggle).toBeDefined();

    // Toggle catalog open
    await act(async () => {
      catalogToggle.props.onPress();
    });

    const momentumItem = root.findAll((n) => n.props?.children === 'Momentum');
    expect(momentumItem.length).toBeGreaterThan(0);
  });

  it('renders populated state with metric items', async () => {
    const mockViews: MetricView[] = [
      {
        metric: {
          id: 'm-1',
          name: 'Momentum',
          domain: 'Discipline/Habits',
          output_unit: 'doings',
          is_quest: false,
          quest_status: null,
          quest_deadline: null,
          created_at: '2026-10-01T00:00:00Z',
          formula_status: 'validated',
          archived_at: null,
        },
        series: {
          metric_id: 'm-1',
          points: [
            { computed_for: '2026-10-19', value: 3 },
            { computed_for: '2026-10-20', value: 5 },
          ],
        },
        kind: 'trend',
        heatmapAvailable: false,
        latest: 5,
        delta: 2,
        progress: 0,
      },
    ];

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<MetricsPanel views={mockViews} isLoading={false} />);
    });

    const root = tree!.root;
    const metricTitle = root.findAll((n) => n.props?.children === 'Momentum');
    expect(metricTitle.length).toBeGreaterThan(0);

    const trendChart = root.find((n) => n.props?.testID === 'metric-trend-m-1');
    expect(trendChart).toBeDefined();
  });
});
