// components/davos/__tests__/ActionZone.test.tsx
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TextInput, Pressable } from 'react-native';
import { ActionZone } from '../ActionZone';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('ActionZone', () => {
  it('disables submit button when text length < 8 or energy not selected', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ActionZone
          savedReport={null}
          onSubmit={jest.fn()}
          onUndo={jest.fn()}
          onEdit={jest.fn()}
        />
      );
    });

    const root = tree!.root;
    const submitBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Submit period report'
    );
    expect(submitBtn.props.disabled).toBe(true);
  });

  it('enables submit button when text >= 8 chars and energy is selected', () => {
    const onSubmit = jest.fn();
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ActionZone
          savedReport={null}
          onSubmit={onSubmit}
          onUndo={jest.fn()}
          onEdit={jest.fn()}
        />
      );
    });

    const root = tree!.root;
    const input = root.findByType(TextInput);

    // Set text to valid length >= 8
    act(() => {
      input.props.onChangeText('Worked on compiler slice');
    });

    // Select energy 7
    const energy7 = root.find(
      (node) => node.props.accessibilityLabel === 'Energy 7 of 10'
    );
    expect(energy7).toBeDefined();
    act(() => {
      energy7.props.onPress();
    });

    const submitBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Submit period report'
    );
    expect(submitBtn.props.disabled).toBe(false);

    // Submit report
    act(() => {
      submitBtn.props.onPress();
    });
    expect(onSubmit).toHaveBeenCalledWith('Worked on compiler slice', 7);
  });

  it('renders saved state with undo and edit actions when report is saved', () => {
    const onUndo = jest.fn();
    const onEdit = jest.fn();
    let tree: renderer.ReactTestRenderer;

    act(() => {
      tree = renderer.create(
        <ActionZone
          savedReport={{ text: 'Completed sprint alignment', energy: 8 }}
          undoSecondsRemaining={6}
          isEditing={false}
          onSubmit={jest.fn()}
          onUndo={onUndo}
          onEdit={onEdit}
        />
      );
    });

    const root = tree!.root;
    const undoBtn = root.find(
      (node) =>
        node.props.accessibilityLabel ===
        'Undo report submission within 6 seconds'
    );
    expect(undoBtn).toBeDefined();

    act(() => {
      undoBtn.props.onPress();
    });
    expect(onUndo).toHaveBeenCalledTimes(1);

    const editBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Edit saved period report'
    );
    expect(editBtn).toBeDefined();
    act(() => {
      editBtn.props.onPress();
    });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
