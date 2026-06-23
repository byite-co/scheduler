import { describe, expect, it } from "vitest";

import { colors, getContrastRatio, meetsAA, tints } from "./index";

describe("M8 accessibility — WCAG AA contrast on token pairs", () => {
  it("primary body/text pairs meet AA for normal text (>= 4.5)", () => {
    expect(meetsAA(colors.ink, colors.canvas)).toBe(true);
    expect(meetsAA(colors.ink, colors.surface)).toBe(true);
    expect(meetsAA(colors.muted, colors.surface)).toBe(true);
    expect(meetsAA(colors.surface, colors.brand)).toBe(true);
  });

  it("status strong-text on its soft background meets AA for normal text", () => {
    expect(meetsAA(tints.successStrong, tints.successSurface)).toBe(true);
    expect(meetsAA(tints.successStrong, tints.successSoft)).toBe(true);
    expect(meetsAA(tints.warningStrong, tints.warningSoft)).toBe(true);
  });

  it("white text is only used on brand (normal) and on danger for bold buttons (large)", () => {
    expect(meetsAA(colors.surface, colors.brand)).toBe(true); // primary buttons
    expect(meetsAA(colors.surface, colors.danger, { large: true })).toBe(true); // bold danger button
  });

  it("urgency colors carry ink text (white on flame/warning fails AA — never used for text)", () => {
    expect(meetsAA(colors.ink, colors.flame)).toBe(true);
    expect(meetsAA(colors.ink, colors.warning)).toBe(true);
    expect(meetsAA(colors.ink, colors.success)).toBe(true);
    // documents the constraint that drives the design rule above:
    expect(meetsAA(colors.surface, colors.flame, { large: true })).toBe(false);
    expect(meetsAA(colors.surface, colors.warning, { large: true })).toBe(false);
  });

  it("computes a known ratio (white on black = 21)", () => {
    expect(Math.round(getContrastRatio("#FFFFFF", "#000000"))).toBe(21);
  });
});
