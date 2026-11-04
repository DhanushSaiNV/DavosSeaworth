// components/davos/TodayPanel.test.tsx
// Deep verification tests for TodayPanel executive agenda and timeline (Blueprint §3).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList } from 'react-native';
import { TodayPanel } from './TodayPanel';
import { buildDaySnapshot } from '../../domain/daySnapshot';
import { typeRoles } from '../../theme/roles';
import { lightColors } from '../../theme/tokens/colors';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('TodayPanel', () => {
  const FIXTURE_NOW = new Date(2026, 10, 3, 18, 4, 0, 0).getTime();

  const samplePlan = [
    {
      id: 'today_1',
      text: 'Team check-in & sprint alignment',
      time: '15:00',
      order: 1,
      status: 'done',
    },
    {
      id: 'today_2',
      text: 'Review test coverage & run regression drill',
      time: '16:00',
      order: 2,
      status: 'late',
    },
    {
      id: 'today_3',
      text: 'Deep work on compiler slice',
      time: '17:00',
      order: 3,
      status: 'done',
    },
    {
      id: 'today_4',
      text: 'Spec review with team',
      time: '18:00',
      order: 4,
      status: 'pending',
    },
    {
      id: 'today_5',
      text: 'Evening reflection & planning',
      time: '20:30',
      order: 5,
      status: 'pending',
    },
  ];

  const sampleDoings = [
    {
      id: 'doing_1630',
      what: 'Wrote compiler parser slice',
      when: '16:30',
      kind: 'action' as const,
    },
    {
      id: 'urge_1740',
      what: 'Distraction urge',
      when: '17:40',
      kind: 'impulse_held' as const,
      durationMin: 10,
    },
  ];

  it('renders populated state with FlatList and chronological timeline', () => {
    const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);
    const onSelectBeat = jest.fn();

    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <TodayPanel snapshot={snapshot} onSelectBeat={onSelectBeat} colorScheme="light" />
      );
    });

    const root = tree!.root;
    const flatList = root.findByType(FlatList);
    expect(flatList).toBeDefined();

    // Verify header meta line
    const metaNode = root.find(
      (node) =>
        (node.type as any) === 'Text' &&
        node.props.children === 'Tue 3 Nov · 3 of 4 answered'
    );
    expect(metaNode).toBeDefined();

    // Verify row pressability
    const pressableRows = root.findAll(
      (node) => node.props.accessibilityRole === 'button'
    );
    expect(pressableRows.length).toBeGreaterThanOrEqual(5);

    // Tap first plan item
    const firstPlanBtn = pressableRows.find((node) =>
      node.props.accessibilityLabel?.includes('Team check-in & sprint alignment')
    );
    expect(firstPlanBtn).toBeDefined();
    act(() => {
      firstPlanBtn!.props.onPress();
    });
    expect(onSelectBeat).toHaveBeenCalledWith('today_1');
  });

  it('renders all four PRD view states correctly', () => {
    // 1. Loading: "Updating"
    let loadingTree: renderer.ReactTestRenderer;
    act(() => {
      loadingTree = renderer.create(
        <TodayPanel state="loading" colorScheme="light" />
      );
    });
    const loadingText = loadingTree!.root.find(
      (node) => (node.type as any) === 'Text' && node.props.children === 'Updating'
    );
    expect(loadingText).toBeDefined();

    // 2. Empty: "No plan for today. Set one now."
    let emptyTree: renderer.ReactTestRenderer;
    act(() => {
      emptyTree = renderer.create(
        <TodayPanel state="empty" onAddItem={jest.fn()} colorScheme="light" />
      );
    });
    const emptyText = emptyTree!.root.find(
      (node) =>
        (node.type as any) === 'Text' &&
        node.props.children === 'No plan for today. Set one now.'
    );
    expect(emptyText).toBeDefined();

    // 3. Error: "Can't refresh. Showing data from 14:05."
    let errorTree: renderer.ReactTestRenderer;
    act(() => {
      errorTree = renderer.create(
        <TodayPanel state="error" colorScheme="light" />
      );
    });
    const errorText = errorTree!.root.find(
      (node) =>
        (node.type as any) === 'Text' &&
        node.props.children === "Can't refresh. Showing data from 14:05."
    );
    expect(errorText).toBeDefined();
  });

  it('mutes completed items and highlights due/missed per Hierarchy Rule', () => {
    const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <TodayPanel snapshot={snapshot} colorScheme="light" />
      );
    });

    const root = tree!.root;

    // 15:00 Done item title
    const doneNode = root.find(
      (node) =>
        (node.type as any) === 'Text' &&
        node.props.children === 'Team check-in & sprint alignment'
    );
    expect(doneNode).toBeDefined();
    const doneStyle = Object.assign({}, ...[].concat(doneNode.props.style));
    // Done title has textSecondary color
    expect(doneStyle.color).toBe(lightColors.textSecondary);

    // 18:00 Due item title
    const dueNode = root.find(
      (node) =>
        (node.type as any) === 'Text' &&
        node.props.children === 'Spec review with team'
    );
    expect(dueNode).toBeDefined();
    const dueStyle = Object.assign({}, ...[].concat(dueNode.props.style));
    // Due title has weight 500
    expect(dueStyle.fontWeight).toBe('500');

    // Missed item actual text
    const actualNode = root.find(
      (node) =>
        (node.type as any) === 'Text' &&
        node.props.children ===
          'Late, answered 16:05. Pulled into an urgent production bug'
    );
    expect(actualNode).toBeDefined();
  });
});
