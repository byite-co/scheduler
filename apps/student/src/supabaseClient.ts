import { createClient } from "@supabase/supabase-js";

import type { Database } from "@ssamplanner/shared";

// 앱 전체가 공유하는 단일 Supabase 클라이언트.
// 화면 모듈마다 따로 만들면 "Multiple GoTrueClient instances" 경고 + 세션 인식 타이밍 문제가 생긴다.
export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);
