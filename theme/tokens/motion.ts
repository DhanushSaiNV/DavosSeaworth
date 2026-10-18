// theme/tokens/motion.ts
// Budgeted motion constants for Davos Seaworth (restrained personality).
// Rules:
// - Micro feedback: 100-120ms
// - Enter: 200-240ms
// - Exit: 150-180ms
// - Large screen transition: <=320ms
// - Enters <= 50ms longer than exits

export const motion = {
  duration: {
    instant: 0,
    micro: 110,
    fast: 150,
    enter: 220,
    exit: 180,
    normal: 240,
    slow: 320,
  },
  easing: {
    standard: [0.2, 0.0, 0.0, 1.0] as const,
    decelerate: [0.0, 0.0, 0.2, 1.0] as const,
    accelerate: [0.4, 0.0, 1.0, 1.0] as const,
  },
} as const;

export type MotionTokens = typeof motion;
