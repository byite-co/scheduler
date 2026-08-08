import { createLazySupabaseClient } from "@ssamplanner/shared";

// Expo 웹 export 시 환경변수가 없는 상태에서도 모듈 로드가 실패하지 않도록 지연 생성한다.
export const supabase = createLazySupabaseClient(
  () => ({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ""
  }),
  "apps/teacher-mobile/.env 의 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY"
);
