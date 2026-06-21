import { describe, expect, it } from "vitest";

import { colors, cssVariables, radii } from "./index";

describe("design tokens", () => {
  it("keeps the approved brand and urgency colors stable", () => {
    expect(colors.brand).toBe("#3D5AFE");
    expect(colors.flame).toBe("#FF6B3D");
  });

  it("exports CSS variables for web consumers", () => {
    expect(cssVariables["--color-brand"]).toBe(colors.brand);
    expect(cssVariables["--radius-card"]).toBe(`${radii.card}px`);
  });
});
