// components/davos/__tests__/RagEvidenceModal.test.tsx
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import { RagEvidenceModal } from '../RagEvidenceModal';

describe('RagEvidenceModal', () => {
  it('renders direct reasoning empty state when blocks are empty', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <RagEvidenceModal
          visible={true}
          onClose={jest.fn()}
          probe={{
            plan: 'ok',
            generation_requests: 1,
            total_chars: 0,
            refined: false,
            bundle_incomplete: false,
          }}
          blocks={[]}
        />
      );
    });

    const root = tree!.root;
    const texts = root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === 'Direct Parametric Reasoning')).toBe(true);

    act(() => {
      tree.unmount();
    });
  });

  it('renders retrieved datasets and records when blocks are present', () => {
    const mockBlocks = [
      {
        dataset: 'rules',
        op: 'match',
        retrieval_method: 'semantic',
        priority: 'essential',
        purpose: 'Fetch communication boundaries',
        row_count: 1,
        rows_returned: 1,
        rows: [
          {
            id: 'rule_1',
            rule_text: 'Stay concise and grounded.',
          },
        ],
      },
    ];

    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <RagEvidenceModal
          visible={true}
          onClose={jest.fn()}
          probe={{
            plan: 'ok',
            generation_requests: 1,
            total_chars: 420,
            refined: false,
            bundle_incomplete: false,
          }}
          blocks={mockBlocks}
        />
      );
    });

    const root = tree!.root;
    const texts = root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === 'rules')).toBe(true);
    expect(texts.some((t) => t.props.children === '"Fetch communication boundaries"')).toBe(true);
    expect(texts.some((t) => t.props.children === 'Stay concise and grounded.')).toBe(true);

    act(() => {
      tree.unmount();
    });
  });

  it('calls onClose when close button is pressed', () => {
    const onClose = jest.fn();
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <RagEvidenceModal
          visible={true}
          onClose={onClose}
          probe={null}
          blocks={[]}
        />
      );
    });

    const root = tree!.root;
    const closeBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Close RAG inspector'
    );
    expect(closeBtn).toBeDefined();

    act(() => {
      closeBtn.props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      tree.unmount();
    });
  });
});
