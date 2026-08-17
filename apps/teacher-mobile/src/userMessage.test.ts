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

  it("연결 수락 RPC 오류를 사용자가 이해할 수 있는 문구로 바꾼다", () => {
    expect(toUserMessage("connection_not_pending")).toBe("이미 처리된 연결 요청입니다.");
    expect(toUserMessage("not_connection_teacher")).toBe("이 연결 요청을 처리할 수 없습니다.");
    expect(toUserMessage("connection_not_found")).toBe("이 연결 요청을 처리할 수 없습니다.");
    expect(toUserMessage("authentication_required")).toBe("로그인이 필요합니다.");
  });

  it("maps common authentication failures", () => {
    expect(toUserMessage("Invalid login credentials")).toBe("이메일 또는 비밀번호를 확인해 주세요.");
  });

  it("keeps intentional user-facing copy", () => {
    expect(toUserMessage("학생을 선택해 주세요.")).toBe("학생을 선택해 주세요.");
  });
});
