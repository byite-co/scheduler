import { createLazySupabaseClient } from "@ssamplanner/shared";

// 과외쌤 앱 전체가 공유하는 단일 Supabase 클라이언트.
//
// 지연 생성이다 — 모듈 로드 시점에 만들면 환경변수가 없는 CI 에서 Next.js 정적 프리렌더가
// "supabaseUrl is required" 로 죽는다(빌드 실패). 첫 사용 시점에 만들면 빌드는 통과하고,
// 환경변수가 진짜 없을 때만 사용 시점에 사람이 읽을 수 있는 오류가 난다.
//
// process.env.NEXT_PUBLIC_* 는 반드시 이 자리에 **리터럴로** 있어야 한다 —
// Next.js 가 빌드 때 값으로 치환하는 대상이 이 표현식이기 때문이다(객체로 넘기면 치환 안 됨).
export const supabase = createLazySupabaseClient(
  () => ({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  }),
  "apps/teacher/.env 의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
);
