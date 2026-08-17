import { describe, expect, it } from "vitest";

import { toUserMessage } from "./userMessage";

describe("toUserMessage", () => {
  it("does not expose UUIDs", () => {
    expect(toUserMessage("row 22de4b52-f6bc-4a6d-a3a9-862c9aa7e426 failed")).toBe(
      "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
    );
  });

  it("does not expose database implementation details", () => {
    expect(toUserMessage('duplicate key violates constraint "connections_pkey"')).toBe(
      "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
    );
  });

  it("maps common authentication failures", () => {
    expect(toUserMessage("Invalid login credentials")).toBe("이메일 또는 비밀번호를 확인해 주세요.");
  });

  it("keeps intentional user-facing copy", () => {
    expect(toUserMessage("학생을 선택해 주세요.")).toBe("학생을 선택해 주세요.");
  });
});
