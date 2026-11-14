// app/__tests__/JournalScreen.test.tsx
// Unit test ensuring JournalScreen renders cleanly without DayProvider.

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  }),
}));

jest.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-id' },
    loading: false,
  }),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import JournalScreen from '../journal';

jest.setTimeout(30000);

describe('JournalScreen (outside DayProvider)', () => {
  it('mounts and renders cleanly without throwing DayContext errors', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<JournalScreen />);
    });
    expect(tree!).toBeDefined();
  });
});
