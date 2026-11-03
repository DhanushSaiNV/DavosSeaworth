// components/davos/Composer.test.tsx
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { Composer } from './Composer';
import { typeRoles } from '../../theme/roles';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('Composer', () => {
  it('renders with single-line height of 44px and proper button labels', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <Composer
          value=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onUrge={jest.fn()}
        />
      );
    });

    const root = tree!.root;
    const input = root.findByType(TextInput);
    expect(input).toBeDefined();

    // Check style has height 44
    const flatStyle = Object.assign({}, ...[].concat(input.props.style));
    expect(flatStyle.height).toBe(44);
    expect(flatStyle.minHeight).toBe(44);
    expect(flatStyle.maxHeight).toBe(112);

    // Verify Urge button label uses davosVoice (body medium, 500)
    const urgeBtn = root.find(
      (node) => node.props.accessibilityLabel === 'Report or resist an urge'
    );
    expect(urgeBtn).toBeDefined();
    const urgeText = urgeBtn.findByType('Text' as any);
    const urgeTextStyle = Object.assign({}, ...[].concat(urgeText.props.style));
    expect(urgeTextStyle.fontSize).toBe(typeRoles.davosVoice.fontSize);
    expect(urgeTextStyle.fontWeight).toBe('500');

    // Verify Send button label uses davosVoice (body medium, 500)
    const sendBtn = root.find(
      (node) =>
        node.props.accessibilityLabel === 'Send message disabled' ||
        node.props.accessibilityLabel === 'Send message'
    );
    expect(sendBtn).toBeDefined();
    const sendText = sendBtn.findByType('Text' as any);
    const sendTextStyle = Object.assign({}, ...[].concat(sendText.props.style));
    expect(sendTextStyle.fontSize).toBe(typeRoles.davosVoice.fontSize);
    expect(sendTextStyle.fontWeight).toBe('500');
  });

  it('grows dynamically between 44px and 112px max upon onContentSizeChange', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <Composer
          value="Line 1"
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onUrge={jest.fn()}
        />
      );
    });

    const root = tree!.root;
    const input = root.findByType(TextInput);

    // Fire content size change to 68px (~2 lines)
    act(() => {
      input.props.onContentSizeChange({
        nativeEvent: { contentSize: { height: 68 } },
      });
    });

    let flatStyle = Object.assign({}, ...[].concat(input.props.style));
    expect(flatStyle.height).toBe(68);

    // Fire content size change exceeding 4 lines (e.g. 200px) -> clamped to 112px
    act(() => {
      input.props.onContentSizeChange({
        nativeEvent: { contentSize: { height: 200 } },
      });
    });

    flatStyle = Object.assign({}, ...[].concat(input.props.style));
    expect(flatStyle.height).toBe(112);
  });

  it('resets height back to 44px when value becomes empty', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <Composer
          value="Multi\nline\ntext"
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onUrge={jest.fn()}
        />
      );
    });

    const root = tree!.root;
    const input = root.findByType(TextInput);

    act(() => {
      input.props.onContentSizeChange({
        nativeEvent: { contentSize: { height: 90 } },
      });
    });

    let flatStyle = Object.assign({}, ...[].concat(input.props.style));
    expect(flatStyle.height).toBe(90);

    // Clear value
    act(() => {
      tree.update(
        <Composer
          value=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onUrge={jest.fn()}
        />
      );
    });

    flatStyle = Object.assign({}, ...[].concat(input.props.style));
    expect(flatStyle.height).toBe(44);
  });
});
