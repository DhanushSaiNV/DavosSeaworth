// app/journal.tsx
// Screen: End-of-Day Journal & Overnight Reflection
// Full-screen modal distraction-free editor (PRD §3.4, §4.4, §12).
// Allows the user to dump their daily thoughts, toggle Unsavable flags on sensitive paragraphs,
// and submit to Davos for overnight insight extraction and next-day anchor planning.

import React, { useEffect } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme';
import { spacing, touchTarget, typeRoles } from '../theme/roles';
import { useAuth } from '../lib/auth';
import { JournalEditor } from '../components/davos/JournalEditor';
import { Icon } from '../components/ui/Icon';
import { hapticSelection } from '../lib/haptics';

export default function JournalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const canvasBg = isDark ? colors.background : colors.surface;

  // Web: Esc closes modal sheet (AU19 precedent)
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && router.canGoBack()) {
          router.back();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [router]);

  const handleClose = () => {
    void hapticSelection();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/chat');
    }
  };

  const handleSuccess = () => {
    // Returning to (app)/today or (app)/chat will automatically refresh day snapshot via focus effect
    handleClose();
  };

  return (
    <View style={[styles.container, { backgroundColor: canvasBg }]}>
      {/* Top Bar with Close Control */}
      <View
        style={[
          styles.topBar,
          {
            borderBottomColor: colors.divider,
            paddingTop: insets.top,
          },
        ]}>
        <View style={styles.topBarInner}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close journal"
            hitSlop={touchTarget.hitSlop}
            android_ripple={{ color: colors.borderSubtle, borderless: true }}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}
            onPress={handleClose}>
            <Icon name="x" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text
            style={[styles.topBarTitle, typeRoles.title, { color: colors.textPrimary }]}
            allowFontScaling={true}>
            Evening Journal
          </Text>
          <View style={styles.topBarSpacer} />
        </View>
      </View>

      {/* Main Journal Editor */}
      <JournalEditor
        userId={user?.id || ''}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: touchTarget.minTargetIos,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  topBarInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    maxWidth: 580,
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  topBarTitle: {
    paddingHorizontal: spacing.none,
  },
  closeButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  topBarSpacer: {
    width: touchTarget.minTargetIos,
  },
});
