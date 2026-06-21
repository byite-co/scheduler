import { describe, expect, it } from "vitest";

import { colors } from "@ssamplanner/design-tokens";

describe("student token import", () => {
  it("uses the shared brand color", () => {
    expect(colors.brand).toBe("#3D5AFE");
  });
});
