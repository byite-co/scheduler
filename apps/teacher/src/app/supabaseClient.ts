import { createClient } from "@supabase/supabase-js";

import type { Database } from "@ssamplanner/shared";

// 과외쌤 앱 전체가 공유하는 단일 Supabase 클라이언트.
export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);
