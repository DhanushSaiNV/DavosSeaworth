// components/brand/BrandLockup.tsx
// Mark + wordmark, as supplied in `assets/davos_logo/logo.svg`. Theme-aware: on dark
// surfaces the wordmark and stem take the paper ink while the circle stays brand amber.

import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '../../theme';
import {
  BRAND_AMBER,
  BRAND_NAVY,
  BRAND_PAPER,
  LOCKUP_CIRCLE,
  LOCKUP_STEM_PATH,
  LOCKUP_VIEW,
  SMALL_MARK_CIRCLE,
  SMALL_MARK_MAX_SIZE,
  SMALL_MARK_STEM_PATH,
  WORDMARK_PATH,
} from './brandArtwork';

export interface BrandLockupProps {
  /** Height of the full lockup in dp; width follows the artwork's aspect ratio. */
  height?: number;
  /**
   * Use the small-size mark (wider gap). Defaults on below `SMALL_MARK_MAX_SIZE`, where the
   * supplied lockup's 1-unit gap visually closes up.
   */
  compact?: boolean;
  /** Single-colour override; when set, the entire lockup takes this colour. */
  color?: string;
  decorative?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function BrandLockup({
  height = 28,
  compact,
  color,
  decorative = false,
  accessibilityLabel = 'Davos',
  style,
}: BrandLockupProps) {
  const { isDark } = useTheme();
  const ink = color ?? (isDark ? BRAND_PAPER : BRAND_NAVY);
  const dot = color ?? BRAND_AMBER;
  const width = Math.round((height * LOCKUP_VIEW.width) / LOCKUP_VIEW.height);
  const useCompact = compact ?? height < SMALL_MARK_MAX_SIZE;

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${LOCKUP_VIEW.width} ${LOCKUP_VIEW.height}`}
      style={style}
      accessible={decorative ? undefined : true}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    >
      {useCompact ? (
        /* Small artwork, scaled so the mark keeps the lockup's 76-unit height and its
           centre at (42.5, 46). The wider gap survives down to favicon-sized renders. */
        <G transform={`translate(42.5, 46) scale(${76 / 77}) translate(-44, -44)`}>
          <Circle
            cx={SMALL_MARK_CIRCLE.cx}
            cy={SMALL_MARK_CIRCLE.cy}
            r={SMALL_MARK_CIRCLE.r}
            fill={dot}
          />
          <Path d={SMALL_MARK_STEM_PATH} fill={ink} fillRule="nonzero" />
        </G>
      ) : (
        <G>
          <Circle cx={LOCKUP_CIRCLE.cx} cy={LOCKUP_CIRCLE.cy} r={LOCKUP_CIRCLE.r} fill={dot} />
          <Path d={LOCKUP_STEM_PATH} fill={ink} fillRule="nonzero" />
        </G>
      )}
      <Path d={WORDMARK_PATH} fill={ink} />
    </Svg>
  );
}
