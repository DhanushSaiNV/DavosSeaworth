// components/ui/Sheet.tsx
// Accessible Bottom Sheet Modal primitive for Davos Seaworth.
// Constraints:
// - No glass/blur inside content (uses solid semantic surface).
// - Accessible modal dialog with drag handle and explicit close CTA.
// - Respects Reduce Motion.

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  AccessibilityInfo,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { IconButton } from './IconButton';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  style?: ViewStyle;
}

export function Sheet({
  visible,
  onClose,
  title,
  description,
  children,
  footer,
  style,
}: SheetProps) {
  const { colors, radius, spacing, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      accessibilityRole="none"
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss sheet"
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onClose}
        />

        <View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: colors.surfaceRaised,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              paddingBottom: Math.max(insets.bottom, spacing.md),
              maxWidth: Math.min(width, 600),
            },
            elevation.overlay,
            style,
          ]}
        >
          {/* Grabber Handle */}
          <View style={styles.grabberWrapper}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          </View>

          {/* Header */}
          {(Boolean(title) || Boolean(onClose)) && (
            <View style={styles.headerRow}>
              <View style={styles.headerText}>
                {title && (
                  <Text role="title" style={styles.titleText}>
                    {title}
                  </Text>
                )}
                {description && (
                  <Text role="caption" variant="secondary" style={styles.descText}>
                    {description}
                  </Text>
                )}
              </View>
              <IconButton
                icon="x"
                accessibilityLabel="Close sheet"
                size="sm"
                onPress={onClose}
              />
            </View>
          )}

          {/* Body Content */}
          <View style={styles.body}>{children}</View>

          {/* Optional Footer */}
          {footer && <View style={[styles.footer, { borderTopColor: colors.borderSubtle }]}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  grabberWrapper: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerText: {
    flex: 1,
    marginRight: 12,
  },
  titleText: {
    marginBottom: 2,
  },
  descText: {
    marginTop: 2,
  },
  body: {
    width: '100%',
  },
  footer: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
