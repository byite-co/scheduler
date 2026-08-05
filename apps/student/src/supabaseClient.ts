import { createLazySupabaseClient } from "@ssamplanner/shared";

// 앱 전체가 공유하는 단일 Supabase 클라이언트.
// 화면 모듈마다 따로 만들면 "Multiple GoTrueClient instances" 경고 + 세션 인식 타이밍 문제가 생긴다.
//
// 지연 생성이다 — 모듈 로드 시점에 만들면 환경변수가 없는 CI 에서 Expo 웹 export(정적 렌더)가
// "supabaseUrl is required" 로 죽는다(빌드 실패). 첫 사용 시점에 만들면 빌드는 통과하고,
// 환경변수가 진짜 없을 때만 사용 시점에 사람이 읽을 수 있는 오류가 난다.
//
// process.env.EXPO_PUBLIC_* / NEXT_PUBLIC_* 는 반드시 이 자리에 **리터럴로** 있어야 한다 —
// Metro 가 빌드 때 값으로 치환(인라인)하는 대상이 이 표현식이기 때문이다.
export const supabase = createLazySupabaseClient(
  () => ({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  }),
  "apps/student/.env 의 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY"
);
