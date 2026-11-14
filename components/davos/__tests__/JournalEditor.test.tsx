// components/davos/__tests__/JournalEditor.test.tsx
// Unit tests for JournalEditor canonical component.

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../lib/journal/journalService', () => ({
  loadJournalDraft: jest.fn().mockResolvedValue(null),
  saveJournalDraft: jest.fn().mockResolvedValue(undefined),
  clearJournalDraft: jest.fn().mockResolvedValue(undefined),
  submitJournalEntry: jest.fn().mockResolvedValue({
    ok: true,
    entryId: 'test-entry-1',
    sentBlocks: 2,
    totalBlocks: 2,
  }),
  simulateOvernightAnchorPlan: jest.fn().mockResolvedValue([]),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TextInput, Pressable } from 'react-native';
import { JournalEditor } from '../JournalEditor';

jest.setTimeout(30000);

describe('JournalEditor Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with distraction-free textarea and empty state', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<JournalEditor userId="user-1" />);
    });

    const root = tree!.root;
    const input = root.findByType(TextInput);
    expect(input).toBeDefined();

    const submitBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Send journal to Davos'
    );
    expect(submitBtn).toBeDefined();
    expect(submitBtn.props.disabled).toBe(true);
  });

  it('updates paragraph blocks and toggles unsavable flag when typing', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<JournalEditor userId="user-1" />);
    });

    const root = tree!.root;
    const input = root.findByType(TextInput);

    // Simulate typing two distinct paragraphs
    await act(async () => {
      input.props.onChangeText('Paragraph one.\n\nParagraph two.');
    });

    const paragraphOne = root.find(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.includes('Paragraph 1')
    );
    expect(paragraphOne).toBeDefined();

    // Toggle paragraph 1 to unsavable
    await act(async () => {
      paragraphOne.props.onPress();
    });

    // Verify it now has flagged label
    expect(paragraphOne.props.accessibilityLabel).toContain('Flagged unsavable');
  });
});
