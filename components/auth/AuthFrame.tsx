// components/auth/AuthFrame.tsx
// Desktop-first authentication frame. On wide screens it becomes a two-panel
// composition: a quiet brand statement on the left and the form card on the
// right. Below the breakpoint it collapses to the familiar centred card.

import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { BrandLockup } from '../brand';
import { Icon, Text } from '../ui';

export interface AuthFrameProps {
  children: React.ReactNode;
}

const WIDE_BREAKPOINT = 960;

export function AuthFrame({ children }: AuthFrameProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, spacing } = useTheme();
  const isWide = width >= WIDE_BREAKPOINT;

  const formColumn = (
    <View style={styles.formColumn}>
      {children}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {isWide ? (
        <View style={styles.wideRow}>
          <View
            style={[
              styles.brandPanel,
              {
                backgroundColor: colors.surfaceSubtle,
                borderRightColor: colors.borderSubtle,
                paddingTop: insets.top + 48,
                paddingBottom: insets.bottom + 48,
              },
            ]}
          >
            <View style={styles.brandInner}>
              <View style={styles.brandIdentity}>
                <BrandLockup height={30} />
                <Text role="caption" variant="tertiary">
                  Life mentor
                </Text>
              </View>

              <View style={styles.brandStatement}>
                <View style={[styles.lanternRule, { backgroundColor: colors.lantern }]} />
                <Text role="display" style={styles.brandHeadline}>
                  A steady voice for the life you are building.
                </Text>
                <Text role="body" variant="secondary" style={styles.brandBody}>
                  Check in with intention, reflect honestly, and keep your focused hours
                  guarded. Davos remembers the context you give him.
                </Text>
              </View>

              <View style={[styles.brandFooter, { borderTopColor: colors.borderSubtle }]}>
                <Icon name="shield" size={14} color={colors.lantern} />
                <Text role="caption" variant="tertiary" style={styles.brandFooterText}>
                  Journal words you flag are removed on this device before anything is sent.
                </Text>
              </View>
            </View>
          </View>

          <ScrollView
            style={styles.formPane}
            contentContainerStyle={[
              styles.formScrollContent,
              {
                paddingTop: insets.top + 32,
                paddingBottom: insets.bottom + 32,
                paddingHorizontal: spacing.lg,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {formColumn}
          </ScrollView>
        </View>
      ) : (
        <ScrollView
          style={styles.root}
          contentContainerStyle={[
            styles.narrowScrollContent,
            {
              paddingTop: insets.top + spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              paddingHorizontal: spacing.sm,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {formColumn}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  wideRow: {
    flex: 1,
    flexDirection: 'row',
  },
  brandPanel: {
    flex: 0.95,
    maxWidth: 620,
    borderRightWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingHorizontal: 56,
  },
  brandInner: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    flex: 1,
    justifyContent: 'space-between',
    maxHeight: 620,
    minHeight: 420,
  },
  brandIdentity: {
    alignItems: 'flex-start',
    gap: 10,
  },
  brandStatement: {
    marginVertical: 40,
  },
  lanternRule: {
    width: 48,
    height: 3,
    borderRadius: 2,
    marginBottom: 20,
  },
  brandHeadline: {
    maxWidth: 360,
    marginBottom: 12,
  },
  brandBody: {
    maxWidth: 390,
    lineHeight: 24,
  },
  brandFooter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
  },
  brandFooterText: {
    flex: 1,
    lineHeight: 18,
  },
  formPane: {
    flex: 1.05,
  },
  formScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  formColumn: {
    width: '100%',
    maxWidth: 440,
  },
  narrowScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
