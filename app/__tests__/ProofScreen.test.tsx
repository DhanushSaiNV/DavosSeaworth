// app/__tests__/ProofScreen.test.tsx
// Unit tests for ProofScreen and dual-tab (Ledger vs Life Metrics) switching.

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      navigate: jest.fn(),
    }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => {
      React.useEffect(() => {
        cb();
      }, []);
    },
  };
});

jest.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-proof' },
    loading: false,
  }),
}));

jest.mock('../../domain/DayContext', () => ({
  useDayContext: () => ({
    snapshot: { now: Date.now(), answered: 10, dueSoFar: 12 },
  }),
}));

jest.mock('../../lib/proofService', () => ({
  fetchProofData: jest.fn().mockResolvedValue({
    checkinsRatio: '18 of 20',
    onTimePercent: '85%',
    urgesHeld: 2,
    weekRangeLabel: 'Oct 30 – Nov 5',
    ledgerDays: [
      {
        date: '2026-11-06',
        label: 'Today',
        doings: [
          { id: 'd1', what: 'Shipped metrics frontend', when: '18:00', kind: 'action' },
        ],
      },
    ],
  }),
}));

jest.mock('../../lib/metricsService', () => ({
  fetchUserMetrics: jest.fn().mockResolvedValue({
    views: [
      {
        metric: {
          id: 'metric-1',
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
          metric_id: 'metric-1',
          points: [
            { computed_for: '2026-11-05', value: 3 },
            { computed_for: '2026-11-06', value: 6 },
          ],
        },
        kind: 'trend',
        heatmapAvailable: false,
        latest: 6,
        delta: 3,
        progress: 0,
      },
    ],
    historyDays: 30,
    lastUpdated: '2026-11-06T18:00:00Z',
  }),
  CORE_METRIC_PRESETS: [],
}));

jest.mock('../../components/ui/LoadingMark', () => ({
  LoadingMark: () => null,
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import ProofScreen from '../(app)/proof';

jest.setTimeout(30000);

describe('ProofScreen with Dual Tabs', () => {
  it('renders Ledger tab by default with Oath and Last 7 days', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ProofScreen />);
    });

    const root = tree!.root;
    const proofTitle = root.findAll((n) => n.props?.children === 'Proof');
    expect(proofTitle.length).toBeGreaterThan(0);

    const sevenDaysHeader = root.findAll((n) => n.props?.children === 'Last 7 days');
    expect(sevenDaysHeader.length).toBeGreaterThan(0);
  });

  it('switches to Life Metrics tab on segmented control press', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ProofScreen />);
    });

    const root = tree!.root;

    // Find the Life Metrics segment button
    const metricsTabBtn = root.find(
      (n) => n.props?.accessibilityLabel === 'Proof section Life Metrics'
    );
    expect(metricsTabBtn).toBeDefined();

    await act(async () => {
      metricsTabBtn.props.onPress();
    });

    // Verify Momentum metric is rendered
    const momentum = root.findAll((n) => n.props?.children === 'Momentum');
    expect(momentum.length).toBeGreaterThan(0);
  });
});
