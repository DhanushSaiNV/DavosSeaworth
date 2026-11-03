// components/davos/SegmentedControl.test.tsx
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SegmentedControl } from './SegmentedControl';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('SegmentedControl', () => {
  const options = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  it('renders all segment options with proper labels and accessibilityState', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <SegmentedControl
          options={options}
          value="light"
          onChange={jest.fn()}
          accessibilityLabelPrefix="Theme"
        />
      );
    });

    const root = tree!.root;

    // Selected option ('light')
    const lightBtn = root.find(
      (node) =>
        node.props.accessibilityLabel === 'Theme Light' &&
        typeof node.props.onPress === 'function'
    );
    expect(lightBtn).toBeDefined();
    expect(lightBtn.props.accessibilityState).toEqual({ selected: true });

    // Unselected option ('dark')
    const darkBtn = root.find(
      (node) =>
        node.props.accessibilityLabel === 'Theme Dark' &&
        typeof node.props.onPress === 'function'
    );
    expect(darkBtn).toBeDefined();
    expect(darkBtn.props.accessibilityState).toEqual({ selected: false });

    // Unselected option ('system')
    const sysBtn = root.find(
      (node) =>
        node.props.accessibilityLabel === 'Theme System' &&
        typeof node.props.onPress === 'function'
    );
    expect(sysBtn).toBeDefined();
    expect(sysBtn.props.accessibilityState).toEqual({ selected: false });
  });

  it('invokes onChange callback when segment is pressed', () => {
    const onChangeMock = jest.fn();
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <SegmentedControl
          options={options}
          value="system"
          onChange={onChangeMock}
        />
      );
    });

    const root = tree!.root;
    const darkBtn = root.find(
      (node) =>
        node.props.accessibilityLabel === 'Dark' &&
        typeof node.props.onPress === 'function'
    );
    expect(darkBtn).toBeDefined();

    act(() => {
      darkBtn.props.onPress();
    });

    expect(onChangeMock).toHaveBeenCalledWith('dark');
  });
});
