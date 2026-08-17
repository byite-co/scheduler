import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("./supabaseClient", () => ({
  supabase: { rpc }
}));

import {
  acceptConnectionRequest,
  acceptConnectionRequestForUi
} from "./connectionAcceptance";

describe("acceptConnectionRequest", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("수락을 원자적 RPC 한 번으로 처리한다", async () => {
    rpc.mockResolvedValue({ data: { status: "active" }, error: null });

    await expect(acceptConnectionRequest("connection-1")).resolves.toEqual({
      ok: true,
      message: "연결을 수락했습니다."
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("accept_connection_request", {
      p_connection_id: "connection-1"
    });
  });

  it("RPC 성공 뒤 목록을 갱신한 다음에만 성공 메시지를 표시한다", async () => {
    rpc.mockResolvedValue({ data: { status: "active" }, error: null });
    const events: string[] = [];

    const accepted = await acceptConnectionRequestForUi("connection-1", {
      clearBusy: () => events.push("busy-cleared"),
      refresh: async () => {
        events.push("refreshed");
      },
      showMessage: (message) => events.push(message)
    });

    expect(accepted).toBe(true);
    expect(events).toEqual(["busy-cleared", "refreshed", "연결을 수락했습니다."]);
  });

  it("RPC 오류 시 처리 상태를 풀고 실패만 표시하며 목록을 성공 갱신하지 않는다", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "connection_not_pending" }
    });
    const clearBusy = vi.fn();
    const refresh = vi.fn();
    const showMessage = vi.fn();

    const accepted = await acceptConnectionRequestForUi("connection-2", {
      clearBusy,
      refresh,
      showMessage
    });

    expect(accepted).toBe(false);
    expect(clearBusy).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledOnce();
    expect(showMessage).toHaveBeenCalledWith("이미 처리된 연결 요청입니다.");
    expect(showMessage).not.toHaveBeenCalledWith("연결을 수락했습니다.");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("네트워크 예외도 실패 상태로 돌려 처리 중 UI가 풀리게 한다", async () => {
    rpc.mockRejectedValue(new Error("network request failed"));

    await expect(acceptConnectionRequest("connection-3")).resolves.toEqual({
      ok: false,
      message: "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
    });
  });
});
