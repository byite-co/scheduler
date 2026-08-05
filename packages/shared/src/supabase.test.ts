import { describe, expect, it, vi } from "vitest";

import { createLazySupabaseClient, readSupabaseConfig } from "./supabase";

describe("readSupabaseConfig", () => {
  it("prefers app-safe public environment variables", () => {
    expect(
      readSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://next.example",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "next-anon",
        SUPABASE_URL: "https://server.example",
        SUPABASE_ANON_KEY: "server-anon"
      })
    ).toEqual({
      url: "https://next.example",
      anonKey: "next-anon"
    });
  });
});

// CI 빌드 실패 재발 방지: 모듈 로드 시점에 클라이언트를 만들면 .env 없는 환경에서
// 프리렌더가 죽는다. 아래가 "생성이 지연된다"는 계약을 고정한다.
describe("createLazySupabaseClient", () => {
  const validConfig = { url: "https://lazy.example.supabase.co", anonKey: "anon-key" };

  it("does not read config or build a client until first use", () => {
    const readConfig = vi.fn(() => validConfig);

    // 생성 시점: 아무것도 하지 않아야 한다(= 빌드/프리렌더가 지나갈 수 있다).
    const client = createLazySupabaseClient(readConfig, "hint");
    expect(readConfig).not.toHaveBeenCalled();

    // 첫 프로퍼티 접근에서만 만들어진다.
    expect(client.from).toBeTypeOf("function");
    expect(readConfig).toHaveBeenCalledTimes(1);
  });

  it("reuses one client across uses (no Multiple GoTrueClient warning)", () => {
    const readConfig = vi.fn(() => validConfig);
    const client = createLazySupabaseClient(readConfig, "hint");

    void client.auth;
    void client.from;
    void client.rpc;

    expect(readConfig).toHaveBeenCalledTimes(1);
  });

  it("keeps methods bound to the real client, not the proxy", () => {
    const client = createLazySupabaseClient(() => validConfig, "hint");

    // Proxy 가 this 로 새면 내부 상태 접근이 깨진다. 실제 쿼리 빌더가 나오는지로 확인.
    const builder = client.from("todos").select("id");
    expect(builder).toBeDefined();
    expect(client.auth).toBeDefined();
  });

  it("throws an actionable error only when actually used without env", () => {
    const client = createLazySupabaseClient(
      () => ({ url: "", anonKey: "" }),
      "apps/teacher/.env 의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );

    // 생성만으로는 throw 하지 않는다.
    expect(client).toBeDefined();
    // 쓰려는 순간에, 어디를 고쳐야 하는지 알려주는 메시지로 실패한다.
    expect(() => client.from("todos")).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => client.from("todos")).toThrow(/apps\/teacher\/\.env/);
  });
});
