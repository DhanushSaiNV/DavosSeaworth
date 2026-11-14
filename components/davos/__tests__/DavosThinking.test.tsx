// components/davos/__tests__/DavosThinking.test.tsx
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import { DavosThinking } from '../DavosThinking';

describe('DavosThinking', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders Davos speaker name and progressbar accessibility role', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<DavosThinking />);
    });

    const root = tree!.root;
    const container = root.find(
      (node) => node.props.accessibilityRole === 'progressbar'
    );
    expect(container).toBeDefined();
    expect(container.props.accessibilityLabel).toBe(
      'Davos is thinking and preparing a response'
    );

    const texts = root.findAllByType(Text);
    const speaker = texts.find((t) => t.props.children === 'DAVOS');
    expect(speaker).toBeDefined();

    act(() => {
      tree.unmount();
    });
  });

  it('renders initial phase text and advances through phases on timer tick', () => {
    const customPhases = ['Reflecting on today…', 'Crafting answer…'];
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<DavosThinking phases={customPhases} />);
    });

    const root = tree!.root;
    let texts = root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === 'Reflecting on today…')).toBe(true);

    // Fast-forward 2.8s
    act(() => {
      jest.advanceTimersByTime(2800);
    });

    texts = root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === 'Crafting answer…')).toBe(true);

    act(() => {
      tree.unmount();
    });
  });
});
