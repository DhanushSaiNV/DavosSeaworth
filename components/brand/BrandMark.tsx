// components/brand/BrandMark.tsx
// The icon-only brand mark. Theme-aware: navy stem on light surfaces, paper stem on dark.
// The drawing is centred on its tight artwork bounds (see MARK_ART) so it sits optically
// centred in square containers instead of inheriting the source file's uneven margins.

import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '../../theme';
import {
  BRAND_AMBER,
  BRAND_NAVY,
  BRAND_PAPER,
  MARK_ART,
  MARK_CIRCLE,
  MARK_STEM_PATH,
  MARK_VIEWBOX,
  SMALL_MARK_CIRCLE,
  SMALL_MARK_MAX_SIZE,
  SMALL_MARK_STEM_PATH,
  SMALL_MARK_VIEWBOX,
} from './brandArtwork';

export interface BrandMarkProps {
  size?: number;
  /** Single-colour override; when set, the entire mark takes this colour. */
  color?: string;
  /** Hide from assistive tech when the mark sits next to an accessible wordmark. */
  decorative?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function BrandMark({
  size = 24,
  color,
  decorative = false,
  accessibilityLabel = 'Davos',
  style,
}: BrandMarkProps) {
  const { isDark } = useTheme();
  const stem = color ?? (isDark ? BRAND_PAPER : BRAND_NAVY);
  const dot = color ?? BRAND_AMBER;
  const small = size < SMALL_MARK_MAX_SIZE;
  const offsetX = MARK_VIEWBOX / 2 - MARK_ART.centerX;
  const offsetY = MARK_VIEWBOX / 2 - MARK_ART.centerY;
  // The small artwork's content is centred in its own 88-unit box; move that centre onto the
  // full mark's artwork centre so the two variants are optically identical in a container.
  const smallOffsetX = MARK_ART.centerX - SMALL_MARK_VIEWBOX / 2;
  const smallOffsetY = MARK_ART.centerY - SMALL_MARK_VIEWBOX / 2;

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      style={style}
      accessible={decorative ? undefined : true}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    >
      {small ? (
        /* Small artwork, translated onto the full mark's centre. Both marks are 77 units
           tall, so this only widens the gap — the mark does not change size at the switch. */
        <G transform={`translate(${smallOffsetX}, ${smallOffsetY})`}>
          <Circle
            cx={SMALL_MARK_CIRCLE.cx}
            cy={SMALL_MARK_CIRCLE.cy}
            r={SMALL_MARK_CIRCLE.r}
            fill={dot}
          />
          <Path d={SMALL_MARK_STEM_PATH} fill={stem} fillRule="nonzero" />
        </G>
      ) : (
        <G transform={`translate(${offsetX}, ${offsetY})`}>
          <Circle cx={MARK_CIRCLE.cx} cy={MARK_CIRCLE.cy} r={MARK_CIRCLE.r} fill={dot} />
          <Path d={MARK_STEM_PATH} fill={stem} fillRule="nonzero" />
        </G>
      )}
    </Svg>
  );
}
