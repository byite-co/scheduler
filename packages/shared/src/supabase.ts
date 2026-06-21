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
