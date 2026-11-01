// components/davos/SideRail.tsx
// Canonical component for Object: Shell regular navigation (PRD §0, §6, §8, §12; design/DESIGN.md §6).
// Width 768-1199dp: Collapsible left rail with 3 items (Cap of 3: Davos, Today, Proof per PRD §6).
// Props: items
// States: selected, collapsed
// Hairline right border, no cards, no elevation.
// Uses only theme/roles.ts. Touch target >= 44dp.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';
import { NavItem } from './BottomNav';

export interface SideRailProps {
  items: NavItem[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  colorScheme?: 'light' | 'dark';
}

export function SideRail({
  items,
  selectedKey,
  onSelect,
  isCollapsed = false,
  onToggleCollapse,
  colorScheme = 'light',
}: SideRailProps) {
  const colors = colorRoles[colorScheme];

  return (
    <View
      style={[
        styles.container,
        isCollapsed ? styles.collapsedWidth : styles.expandedWidth,
        {
          borderRightColor: colors.divider,
          backgroundColor: colors.surface,
        },
      ]}>
      {/* Collapse / Expand toggle button at top */}
      {onToggleCollapse && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isCollapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
          hitSlop={touchTarget.hitSlop}
          style={styles.toggleButton}
          onPress={onToggleCollapse}>
          <Text
            style={[styles.toggleText, typeRoles.figure, { color: colors.textSecondary }]}
            allowFontScaling={true}>
            {isCollapsed ? '>>' : '<<'}
          </Text>
        </Pressable>
      )}

      {/* Nav items list */}
      <View style={styles.itemsList}>
        {items.map((item) => {
          const isSelected = item.key === selectedKey;

          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}${isSelected ? ', selected' : ''}`}
              hitSlop={touchTarget.hitSlop}
              style={[
                styles.navItem,
                isSelected
                  ? { borderLeftColor: colors.accent, backgroundColor: colors.surface }
                  : { borderLeftColor: colors.transparent },
              ]}
              onPress={() => onSelect?.(item.key)}>
              {item.glyph ? (
                <Text
                  style={[
                    styles.glyphText,
                    typeRoles.figure,
                    { color: isSelected ? colors.accent : colors.textSecondary },
                  ]}
                  allowFontScaling={true}>
                  {item.glyph}
                </Text>
              ) : null}

              {!isCollapsed && (
                <Text
                  style={[
                    styles.itemLabel,
                    typeRoles.heading,
                    {
                      color: isSelected ? colors.textPrimary : colors.textSecondary,
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
    paddingHorizontal: spacing.xs,
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  expandedWidth: {
    width: 180,
  },
  collapsedWidth: {
    width: 60,
    alignItems: 'center',
  },
  toggleButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleText: {
    paddingHorizontal: spacing.none,
  },
  itemsList: {
    gap: spacing.xs,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.minTargetIos,
    paddingHorizontal: spacing.xs,
    borderLeftWidth: 3,
  },
  glyphText: {
    minWidth: 24,
    textAlign: 'center',
  },
  itemLabel: {
    paddingHorizontal: spacing.none,
  },
});
