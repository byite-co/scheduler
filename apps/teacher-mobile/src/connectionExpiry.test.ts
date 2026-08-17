import { describe, expect, it } from "vitest";

import { getInviteExpiry } from "./connectionExpiry";

describe("getInviteExpiry", () => {
  const now = new Date("2026-08-17T00:00:00.000Z");

  it("shows ordinary remaining hours for a valid code", () => {
    expect(getInviteExpiry("2026-08-18T23:59:00.000Z", now)).toEqual({
      state: "valid",
      label: "48시간 남음"
    });
  });

  it("marks three hours or less as urgent", () => {
    expect(getInviteExpiry("2026-08-17T03:00:00.000Z", now)).toEqual({
      state: "urgent",
      label: "3시간 남음"
    });
  });

  it("marks an elapsed code as expired", () => {
    expect(getInviteExpiry("2026-08-17T00:00:00.000Z", now)).toEqual({
      state: "expired",
      label: "만료됨"
    });
  });

  it("fails closed for an invalid expiry", () => {
    expect(getInviteExpiry("not-a-date", now)).toEqual({ state: "expired", label: "만료됨" });
  });
});
