import { describe, expect, it } from "vitest";

import { readSupabaseConfig } from "./supabase";

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
