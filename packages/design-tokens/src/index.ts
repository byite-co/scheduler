export const colors = {
  brand: "#3D5AFE",
  flame: "#FF6B3D",
  ink: "#161A2E",
  muted: "#646B7D",
  canvas: "#F5F7FB",
  surface: "#FFFFFF",
  line: "#DDE3F0",
  success: "#15A66B",
  warning: "#E0A100",
  danger: "#E2483B"
} as const;

export const radii = {
  card: 18,
  button: 12,
  chip: 999,
  control: 8
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const;

export const typography = {
  fontFamily:
    "Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Segoe UI, sans-serif",
  numericVariant: "tabular-nums"
} as const;

export const shadows = {
  soft: "0 16px 40px rgba(22, 26, 46, 0.08)"
} as const;

export const cssVariables = {
  "--color-brand": colors.brand,
  "--color-flame": colors.flame,
  "--color-ink": colors.ink,
  "--color-muted": colors.muted,
  "--color-canvas": colors.canvas,
  "--color-surface": colors.surface,
  "--color-line": colors.line,
  "--color-success": colors.success,
  "--color-warning": colors.warning,
  "--color-danger": colors.danger,
  "--radius-card": `${radii.card}px`,
  "--radius-button": `${radii.button}px`,
  "--radius-control": `${radii.control}px`,
  "--shadow-soft": shadows.soft
} as const;

export type ColorName = keyof typeof colors;
export type CssTokenName = keyof typeof cssVariables;
