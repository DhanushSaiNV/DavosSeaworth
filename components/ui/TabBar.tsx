// components/ui/TabBar.tsx
// Accessible Tab Bar navigation primitive for Davos Seaworth.
// Constraints:
// - Labels required on every tab.
// - Tap targets >=44x44pt iOS, >=48x48dp Android.
// - No liquid glass/shimmer/blur in content.
// - Full accessibility: accessibilityRole="tablist" and "tab".

import React from 'react';
import { View, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { hapticSelection } from '../../lib/haptics';

export interface TabItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: number | string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabPress: (tabId: string) => void;
  style?: ViewStyle;
}

export function TabBar({
  tabs,
  activeTab,
  onTabPress,
  style,
}: TabBarProps) {
  const { colors, touchTarget } = useTheme();
  const insets = useSafeAreaInsets();

  const handleTabPress = (tabId: string) => {
    if (tabId === activeTab) return;
    void hapticSelection();
    onTabPress(tabId);
  };

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSubtle,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        style,
      ]}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const color = isActive ? colors.accent : colors.textTertiary;

        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={`${tab.label} tab`}
            accessibilityState={{ selected: isActive }}
            onPress={() => handleTabPress(tab.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => [
              styles.tabItem,
              {
                minHeight: touchTarget.minHeight,
                minWidth: touchTarget.minWidth,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <View style={styles.iconWrapper}>
              <Icon name={tab.icon} size={22} color={color} />
              {tab.badge ? (
                <View style={[styles.badge, { backgroundColor: colors.danger }]}>
                  <Text role="caption" tabular style={styles.badgeText}>
                    {tab.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              role="caption"
              style={[
                styles.tabLabel,
                {
                  color,
                  fontWeight: isActive ? '600' : '500',
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  iconWrapper: {
    position: 'relative',
    marginBottom: 4,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    borderRadius: 8,
    paddingHorizontal: 4,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  tabLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
});
