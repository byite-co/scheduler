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

// 승인된 시맨틱 소프트 틴트(상태 배경/테두리/강조 텍스트). 임의 색 금지 — 이 집합만 사용.
export const tints = {
  brandSoft: "#EEF2FF",
  successSoft: "#E6F7EF",
  successSurface: "#F0FFF7",
  successBorder: "#BFEFD7",
  successStrong: "#087A47",
  warningSoft: "#FFF6E0",
  warningBorder: "#F4E2A8",
  warningStrong: "#7A5700",
  dangerSoft: "#FDECEA",
  dangerBorder: "#F7C7C2",
  flameSoft: "#FFE8DF",
  flameNudge: "#FFF2ED",
  flameNudgeBorder: "#FFCDBD"
} as const;

// 승인 팔레트(접근성/토큰 가드에서 사용): 기본 색 + 시맨틱 틴트.
export const approvedColorValues: string[] = [
  ...Object.values(colors),
  ...Object.values(tints)
].map((value) => value.toUpperCase());

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function getContrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG AA: 일반 텍스트 4.5:1, 큰/굵은 텍스트 3:1.
export function meetsAA(foreground: string, background: string, options: { large?: boolean } = {}): boolean {
  return getContrastRatio(foreground, background) >= (options.large ? 3 : 4.5);
}

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
