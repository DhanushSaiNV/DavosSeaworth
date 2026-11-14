// components/davos/DavosThinking.tsx
// Modern Generative AI Loading State for Davos conversation stream (2026).
// Features:
// 1. Phased cognitive reasoning stages ("Reviewing your plan…", "Reflecting on your day…", "Formulating guidance…").
// 2. Breathing amber beacon orb synced with subtle neural thought shimmer stream.
// 3. Calm unboxed layout matching Davos speaker identity. Zero 2007 spinners or bouncing balls.
// 4. Full accessibility and Reduce Motion support. RN primitives only.

import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../../theme';
import { radius, typeRoles } from '../../theme/roles';

const THINKING_PHASES = [
  'Reviewing your plan…',
  'Reflecting on your day…',
  'Formulating guidance…',
];

export interface DavosThinkingProps {
  /** Optional custom phase texts */
  phases?: string[];
  /** Accessibility announcement label */
  accessibilityLabel?: string;
}

export function DavosThinking({
  phases = THINKING_PHASES,
  accessibilityLabel = 'Davos is thinking and preparing a response',
}: DavosThinkingProps) {
  const { colors } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const shimmerAnim = useRef(new Animated.Value(0.3)).current;
  const phaseFadeAnim = useRef(new Animated.Value(1)).current;

  // Listen for accessibility reduce motion setting
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => sub.remove();
  }, []);

  // Step through cognitive reflection phases over time
  useEffect(() => {
    if (phases.length <= 1) return;

    const interval = setInterval(() => {
      if (!reduceMotion) {
        Animated.sequence([
          Animated.timing(phaseFadeAnim, {
            toValue: 0.2,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(phaseFadeAnim, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
        ]).start();
      }

      setPhaseIndex((prev) => (prev + 1) % phases.length);
    }, 2800);

    return () => clearInterval(interval);
  }, [phases, reduceMotion, phaseFadeAnim]);

  // Ambient generative pulse and stream shimmer loop
  useEffect(() => {
    if (reduceMotion) {
      pulseAnim.setValue(1);
      shimmerAnim.setValue(0.6);
      return;
    }

    // 1. Beacon orb breathing animation
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    // 2. Stream shimmer breathing animation
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 0.85,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0.25,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();
    shimmerLoop.start();

    return () => {
      pulseLoop.stop();
      shimmerLoop.stop();
    };
  }, [reduceMotion, pulseAnim, shimmerAnim]);

  const activePhase = phases[phaseIndex] || phases[0];

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        { borderBottomColor: colors.borderSubtle },
      ]}>
      {/* 1. Speaker Meta Row */}
      <View style={styles.metaRow}>
        <View style={styles.speakerGroup}>
          <Text
            style={[
              styles.speakerName,
              typeRoles.meta,
              { color: colors.textPrimary, fontWeight: '700' },
            ]}
            allowFontScaling={true}>
            DAVOS
          </Text>

          {/* Ambient Amber Beacon Orb */}
          <View style={styles.beaconWrap}>
            <Animated.View
              style={[
                styles.beaconHalo,
                {
                  backgroundColor: colors.lanternSurface,
                  transform: [
                    {
                      scale: pulseAnim.interpolate({
                        inputRange: [0.35, 1],
                        outputRange: [0.9, 1.45],
                      }),
                    },
                  ],
                  opacity: pulseAnim,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.beaconCore,
                {
                  backgroundColor: colors.lantern,
                  opacity: pulseAnim.interpolate({
                    inputRange: [0.35, 1],
                    outputRange: [0.7, 1],
                  }),
                },
              ]}
            />
          </View>
        </View>

        {/* Cognitive Phase Text */}
        <Animated.Text
          style={[
            styles.phaseText,
            typeRoles.meta,
            { color: colors.textTertiary, opacity: phaseFadeAnim },
          ]}
          allowFontScaling={true}>
          {activePhase}
        </Animated.Text>
      </View>

      {/* 2. Modern Generative Stream Shimmer (Text in gestation) */}
      <View style={styles.streamContainer}>
        {/* Ambient streaming text lines */}
        <Animated.View
          style={[
            styles.streamLinePrimary,
            {
              backgroundColor: colors.surfaceSubtle,
              opacity: shimmerAnim.interpolate({
                inputRange: [0.25, 0.85],
                outputRange: [0.4, 0.85],
              }),
            },
          ]}
        />
        <Animated.View
          style={[
            styles.streamLineSecondary,
            {
              backgroundColor: colors.surfaceSubtle,
              opacity: shimmerAnim.interpolate({
                inputRange: [0.25, 0.85],
                outputRange: [0.25, 0.65],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    width: '100%',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  speakerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  speakerName: {
    fontSize: 11,
    letterSpacing: 0.8,
  },
  beaconWrap: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconHalo: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: radius.full,
  },
  beaconCore: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  phaseText: {
    fontSize: 10,
    fontStyle: 'italic',
    letterSpacing: 0.3,
  },
  streamContainer: {
    gap: 7,
    paddingTop: 2,
  },
  streamLinePrimary: {
    height: 14,
    width: '78%',
    borderRadius: radius.sm,
  },
  streamLineSecondary: {
    height: 14,
    width: '52%',
    borderRadius: radius.sm,
  },
});
