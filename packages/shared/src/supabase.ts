import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions
} from "@supabase/supabase-js";

import type { Database } from "./database.types";

export type SsamplannerSupabaseClient = SupabaseClient<Database>;

export type SupabaseClientConfig = {
  url: string;
  anonKey: string;
  options?: SupabaseClientOptions<"public">;
};

export function createSsamplannerSupabaseClient({
  url,
  anonKey,
  options
}: SupabaseClientConfig): SsamplannerSupabaseClient {
  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key are required");
  }

  return createClient<Database>(url, anonKey, options);
}

// 지연(lazy) 생성 클라이언트.
//
// 왜 필요한가: 모듈 로드 시점에 createClient() 를 부르면 환경변수가 없는 환경에서
// "supabaseUrl is required" 로 즉시 throw 한다. Next.js 정적 프리렌더와 Expo 웹 export 는
// 모듈을 평가하므로, .env 가 없는 CI 에서는 **빌드 자체가 죽었다**.
// → 첫 사용 시점까지 생성을 미루면 빌드는 모듈만 평가하고 지나가고,
//   실제로 쓰려는 순간에만(=런타임) 환경변수를 요구한다.
//
// 반환값이 Proxy 라서 기존 호출부(`supabase.from(...)`, `supabase.auth...`)는 한 줄도
// 바꾸지 않는다. 메서드는 실제 클라이언트에 bind 해서 넘기므로 `this` 가 어긋나지 않는다.
// 클라이언트는 한 번만 만들어 재사용한다("Multiple GoTrueClient instances" 경고 방지).
export function createLazySupabaseClient(
  readConfig: () => SupabaseClientConfig,
  missingEnvHint: string
): SsamplannerSupabaseClient {
  let cached: SsamplannerSupabaseClient | null = null;

  function resolveClient(): SsamplannerSupabaseClient {
    if (cached) return cached;

    const config = readConfig();
    if (!config.url || !config.anonKey) {
      throw new Error(
        `Supabase 환경변수가 없어 클라이언트를 만들 수 없습니다. ${missingEnvHint} 를 설정해 주세요. ` +
          "(빌드는 통과합니다 — 이 오류는 Supabase 를 실제로 사용하는 시점에만 발생합니다.)"
      );
    }

    cached = createSsamplannerSupabaseClient(config);
    return cached;
  }

  return new Proxy({} as SsamplannerSupabaseClient, {
    get(_target, property) {
      const instance = resolveClient() as unknown as Record<string | symbol, unknown>;
      const value = instance[property];
      // 메서드는 실제 인스턴스에 bind — Proxy 가 this 가 되면 내부 상태 접근이 깨진다.
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(instance)
        : value;
    }
  });
}

export function readSupabaseConfig(
  env: Record<string, string | undefined>
): SupabaseClientConfig {
  return {
    url:
      env.NEXT_PUBLIC_SUPABASE_URL ??
      env.EXPO_PUBLIC_SUPABASE_URL ??
      env.SUPABASE_URL ??
      "",
    anonKey:
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      env.SUPABASE_ANON_KEY ??
      ""
  };
}
