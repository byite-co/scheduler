import { describe, expect, it } from "vitest";

import { createSecureInviteCode } from "./inviteCode";

describe("createSecureInviteCode", () => {
  it("creates a six-character code from the unambiguous alphabet", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(createSecureInviteCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });
});
