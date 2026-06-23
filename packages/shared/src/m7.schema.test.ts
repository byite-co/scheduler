import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260627000000_m7_account_system.sql", import.meta.url),
  "utf8"
);

describe("M7 account + system schema coverage", () => {
  it("self-service account deletion cascades from auth.users", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("create or replace function delete_my_account");
      expect(source).toContain("delete from auth.users where id = auth.uid()");
      expect(source).toContain("grant execute on function delete_my_account() to authenticated");
    }
  });

  it("public-readable system config for force-update/maintenance gating", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("app_config");
      expect(source).toContain("min_supported_build");
      expect(source).toContain("create policy app_config_read on app_config for select to anon, authenticated");
    }
  });
});
