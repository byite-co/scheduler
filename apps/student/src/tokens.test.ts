import { describe, expect, it } from "vitest";

import { colors } from "@ssamplanner/design-tokens";
import { M1_ROUTE_MANIFEST } from "@ssamplanner/shared";

describe("student token import", () => {
  it("uses the shared brand color", () => {
    expect(colors.brand).toBe("#3D5AFE");
  });

  it("includes M1 student auth and onboarding routes", () => {
    expect(M1_ROUTE_MANIFEST.student).toEqual(
      expect.arrayContaining([
        "/signup",
        "/signup/terms",
        "/signup/profile",
        "/onboarding/connect",
        "/onboarding/connect/status",
        "/onboarding/disclosure"
      ])
    );
  });
});
