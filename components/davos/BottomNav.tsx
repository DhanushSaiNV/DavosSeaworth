// components/davos/BottomNav.tsx
// Canonical component for Object: Shell compact navigation (PRD §0, §6, §8, §12; design/DESIGN.md §6).
// Width < 768dp: Bottom bar with 3 items (Cap of 3: Davos, Today, Proof per PRD §6).
// Props: items
// States: selected, collapsed
// Hairline divider, no cards, no elevation.
// Uses theme hook (PRD Step 0, A.2, AU37). Touch target >= 44dp.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

import { Icon } from '../ui/Icon';

export interface NavItem {
  key: string;
  label: string;
  glyph?: string;
  icon?: string;
}

export interface BottomNavProps {
  items: NavItem[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
  isCollapsed?: boolean;
  colorScheme?: 'light' | 'dark';
}

const ICON_MAP: Record<string, string> = {
  chat: 'message-square',
  today: 'calendar',
  proof: 'shield',
};

export function BottomNav({
  items,
  selectedKey,
  onSelect,
  isCollapsed = false,
  colorScheme,
}: BottomNavProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const isDark = colorScheme ? colorScheme === 'dark' : theme.isDark;
  const canvasBg = isDark ? colors.background : colors.surface;

  // State: collapsed (bar minimized/collapsed per spec)
  if (isCollapsed) {
    return (
      <View style={[styles.collapsedContainer, { borderTopColor: colors.divider }]}>
        <Text
          style={[styles.collapsedText, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Navigation bar collapsed
        </Text>
      </View>
    );
  }

  // State: selected (active nav items with selection indicator)
  return (
    <View style={[styles.container, { borderTopColor: colors.divider, backgroundColor: canvasBg }]}>
      {items.map((item) => {
        const isSelected = item.key === selectedKey;
        const iconName = item.icon ?? ICON_MAP[item.key] ?? 'circle';

        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={`${item.label} tab${isSelected ? ', selected' : ''}`}
            hitSlop={touchTarget.hitSlop}
            style={[
              styles.navItem,
              isSelected ? { borderTopColor: colors.brandAmber } : { borderTopColor: colors.transparent },
            ]}
            onPress={() => onSelect?.(item.key)}>
            <Icon
              name={iconName}
              size="sm"
              color={isSelected ? colors.textPrimary : colors.textSecondary}
            />
            <Text
              style={[
                styles.itemLabel,
                typeRoles.meta,
                {
                  color: isSelected ? colors.textPrimary : colors.textSecondary,
                  fontWeight: isSelected ? '600' : '400',
                },
              ]}
              allowFontScaling={true}>
              {item.label}
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
    paddingHorizontal: spacing.sm,
  },
  collapsedContainer: {
    paddingVertical: spacing.xs,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  collapsedText: {
    paddingHorizontal: spacing.none,
  },
  navItem: {
    flex: 1,
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxs,
    borderTopWidth: 2,
    gap: spacing.xxs,
  },
  itemLabel: {
    paddingHorizontal: spacing.none,
  },
});
