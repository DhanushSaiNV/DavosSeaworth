// components/davos/__tests__/PlanEditorModal.test.tsx
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Pressable } from 'react-native';
import { PlanEditorModal } from '../PlanEditorModal';
import { redesignPlanAnchors } from '../../../fixtures/davos';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('PlanEditorModal', () => {
  it('renders initial anchors and saves updated list', () => {
    const onSave = jest.fn();
    let tree: renderer.ReactTestRenderer;

    act(() => {
      tree = renderer.create(
        <PlanEditorModal
          visible={true}
          initialAnchors={redesignPlanAnchors}
          onClose={jest.fn()}
          onSave={onSave}
        />
      );
    });

    const root = tree!.root;
    const saveBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Save plan anchors'
    );
    expect(saveBtn).toBeDefined();

    act(() => {
      saveBtn.props.onPress();
    });

    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0][0];
    expect(saved.length).toBe(redesignPlanAnchors.length);
  });

  it('allows adding a new anchor up to 12 items', () => {
    const onSave = jest.fn();
    let tree: renderer.ReactTestRenderer;

    act(() => {
      tree = renderer.create(
        <PlanEditorModal
          visible={true}
          initialAnchors={redesignPlanAnchors.slice(0, 2)}
          onClose={jest.fn()}
          onSave={onSave}
        />
      );
    });

    const root = tree!.root;
    const addBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Add a planned anchor'
    );
    expect(addBtn).toBeDefined();

    act(() => {
      addBtn.props.onPress();
    });

    // Provide title for the newly added anchor so validation passes
    const textInputs = root.findAllByType('TextInput' as any);
    const lastTitleInput = textInputs.find(
      (node) => node.props.accessibilityLabel === 'Plan anchor title' && !node.props.value
    );
    if (lastTitleInput) {
      act(() => {
        lastTitleInput.props.onChangeText('Evening workout');
      });
    }

    // Save and verify length is 3
    act(() => {
      root
        .find((node) => node.props.accessibilityLabel === 'Save plan anchors')
        .props.onPress();
    });
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0].length).toBe(3);
  });
});
