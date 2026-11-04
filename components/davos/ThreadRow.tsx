// components/davos/ThreadRow.tsx
// Canonical row layout for Chat stream (Blueprint §2.1, §4.3).
// Columns inside 680 column:
// gutter x0–48 | rail x48–72 (glyph centered at x=60) | content x72→end.

import React from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme';
import { typeRoles } from '../../theme/roles';
import {
  GUTTER,
  RAIL,
  LINE,
  META_LINE,
  GLYPH_CHAT,
} from '../../theme/layout';
import { StatusGlyph, type GlyphState } from '../StatusGlyph';

export interface ThreadRowProps {
  time?: string;
  showTime?: boolean;
  glyph?: GlyphState;
  isLivePrompt?: boolean;
  isLive?: boolean;
  isMetaRow?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ThreadRow({
  time,
  showTime = false,
  glyph,
  isLivePrompt = false,
  isLive = false,
  isMetaRow = false,
  children,
  style,
}: ThreadRowProps) {
  const { colors } = useTheme();
  const live = isLivePrompt || isLive;
  const lineHeight = isMetaRow ? META_LINE : LINE;

  return (
    <View style={[styles.row, style]}>
      {/* 1. Time gutter x0–48 */}
      <View style={styles.gutter}>
        {showTime && time ? (
          <Text
            style={[
              styles.gutterTime,
              typeRoles.figure,
              {
                color: live ? colors.textPrimary : colors.textTertiary,
                lineHeight,
                height: lineHeight,
                fontSize: isMetaRow ? 12 : 15,
              },
            ]}
            allowFontScaling={true}>
            {time}
          </Text>
        ) : null}
      </View>

      {/* 2. Rail x48–72 (glyph centered at x=60) */}
      <View style={styles.rail}>
        {glyph ? (
          <View style={[styles.glyphContainer, { height: lineHeight }]}>
            <StatusGlyph state={glyph} size={GLYPH_CHAT} />
          </View>
        ) : null}
      </View>

      {/* 3. Content column x72→end */}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
  },
  gutter: {
    width: GUTTER, // 48: x0 to x48
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  gutterTime: {
    paddingHorizontal: 0,
  },
  rail: {
    width: RAIL, // 24: x48 to x72. Center is 48 + 12 = 60
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  glyphContainer: {
    width: RAIL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1, // starts at x=72
    justifyContent: 'flex-start',
  },
});
