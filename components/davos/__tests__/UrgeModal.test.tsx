// components/davos/__tests__/UrgeModal.test.tsx
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { UrgeModal } from '../UrgeModal';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('UrgeModal', () => {
  it('renders log stage and starts hold with trigger and intensity', () => {
    const onStartHold = jest.fn();
    let tree: renderer.ReactTestRenderer;

    act(() => {
      tree = renderer.create(
        <UrgeModal
          visible={true}
          stage="log"
          trigger=""
          intensity={null}
          countdown="10:00"
          onClose={jest.fn()}
          onStartHold={onStartHold}
          onExtendHold={jest.fn()}
          onResolve={jest.fn()}
        />
      );
    });

    const root = tree!.root;
    const input = root.findByType(TextInput);

    act(() => {
      input.props.onChangeText('Check phone');
    });

    const intensityBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Intensity 5'
    );
    act(() => {
      intensityBtn.props.onPress();
    });

    const startBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Start 10-minute hold'
    );
    act(() => {
      startBtn.props.onPress();
    });

    expect(onStartHold).toHaveBeenCalledWith('Check phone', 5);
  });

  it('renders hold in progress with countdown and resolve options', () => {
    const onResolve = jest.fn();
    let tree: renderer.ReactTestRenderer;

    act(() => {
      tree = renderer.create(
        <UrgeModal
          visible={true}
          stage="hold"
          trigger="YouTube urge"
          intensity={7}
          countdown="08:45"
          onClose={jest.fn()}
          onStartHold={jest.fn()}
          onExtendHold={jest.fn()}
          onResolve={onResolve}
        />
      );
    });

    const root = tree!.root;
    const resistedBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Report urge resisted'
    );
    expect(resistedBtn).toBeDefined();

    act(() => {
      resistedBtn.props.onPress();
    });
    expect(onResolve).toHaveBeenCalledWith('held');
  });
});
