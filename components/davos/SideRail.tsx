// components/davos/SideRail.tsx
// Canonical component for Object: Shell regular navigation (PRD §0, §6, §8, §12; design/DESIGN.md §6).
// Width 768-1199dp: Collapsible left rail with 3 items (Cap of 3: Davos, Today, Proof per PRD §6).
// Props: items
// States: selected, collapsed
// Hairline right border, no cards, no elevation.
// Uses theme hook (PRD Step 0, A.2, AU37). Touch target >= 44dp.

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { NavItem } from './BottomNav';
import { LogoMark } from './LogoMark';
import { Icon } from '../ui/Icon';
import { hapticSelection } from '../../lib/haptics';

export interface SideRailProps {
  items: NavItem[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  colorScheme?: 'light' | 'dark';
}

const ICON_MAP: Record<string, string> = {
  chat: 'message-square',
  today: 'calendar',
  proof: 'shield',
};

export function SideRail({
  items,
  selectedKey,
  onSelect,
  isCollapsed = false,
  onToggleCollapse,
  colorScheme,
}: SideRailProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;
  const isDark = colorScheme ? colorScheme === 'dark' : theme.isDark;
  const canvasBg = isDark ? colors.background : colors.surface;
  const bottomInset = insets.bottom > 0 ? insets.bottom : spacing.xs;

  return (
    <View
      style={[
        styles.container,
        isCollapsed ? styles.collapsedWidth : styles.expandedWidth,
        {
          borderRightColor: colors.divider,
          backgroundColor: canvasBg,
          paddingTop: insets.top,
          paddingBottom: bottomInset,
        },
      ]}>
      {/* 1. LogoMark at 24px at the top of the rail (AU1/F3). Repo lacks Cairn mark, keeping BrandMark. */}
      <View style={styles.logoRow}>
        <LogoMark size={24} />
      </View>

      {/* 2. Collapse / Expand toggle button with real vector icon */}
      {onToggleCollapse && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isCollapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
          hitSlop={touchTarget.hitSlop}
          style={styles.toggleButton}
          onPress={onToggleCollapse}>
          <Icon
            name={isCollapsed ? 'chevrons-right' : 'chevrons-left'}
            size="sm"
            color={colors.textSecondary}
          />
        </Pressable>
      )}

      {/* 3. Nav items list */}
      <View style={styles.itemsList}>
        {items.map((item) => {
          const isSelected = selectedKey !== undefined && selectedKey !== null && item.key === selectedKey;
          const iconName = item.icon ?? ICON_MAP[item.key] ?? 'circle';

          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}${isSelected ? ', selected' : ''}`}
              {...(Platform.OS === 'web' ? ({ title: item.label } as any) : {})}
              hitSlop={touchTarget.hitSlop}
              android_ripple={{ color: colors.borderSubtle, borderless: false }}
              style={({ pressed }) => [
                styles.navItem,
                isSelected
                  ? { borderLeftColor: colors.brandAmber, backgroundColor: colors.surface }
                  : { borderLeftColor: colors.transparent },
                pressed && { opacity: 0.75 },
              ]}
              onPress={() => {
                void hapticSelection();
                onSelect?.(item.key);
              }}>
              <Icon
                name={iconName}
                size="md"
                color={isSelected ? colors.textPrimary : colors.textSecondary}
              />
              {!isCollapsed && (
                <Text
                  style={[
                    styles.itemLabel,
                    typeRoles.davosVoice,
                    {
                      color: isSelected ? colors.textPrimary : colors.textSecondary,
                      fontWeight: isSelected ? '600' : '400',
                    },
                  ]}
                  allowFontScaling={true}>
                  {item.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  expandedWidth: {
    width: 180,
  },
  collapsedWidth: {
    width: 60,
  },
  logoRow: {
    paddingLeft: spacing.sm, // 16px left edge
    paddingVertical: spacing.xxs,
    minHeight: 28,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  toggleButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingLeft: spacing.sm, // 16px left edge
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  itemsList: {
    gap: spacing.xs,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.minTargetIos,
    borderLeftWidth: 3,
    paddingLeft: spacing.sm - 3, // 3 + 13 = 16px left edge (shares one left edge with logo & collapse)
    paddingRight: spacing.xs,
  },
  itemLabel: {
    paddingHorizontal: spacing.none,
  },
});
