import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260625000000_m5_report_sharing.sql", import.meta.url),
  "utf8"
);

describe("M5 report sharing schema coverage", () => {
  it("exposes a parent share RPC to anon with token validation and view logging", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("create or replace function get_shared_report");
      expect(source).toContain("grant execute on function get_shared_report(text) to anon");
      expect(source).toContain("insert into report_views (report_id)");
      expect(source).toContain("'status', 'expired'");
    }
  });

  it("lets only an authorized teacher mint a share token", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("create or replace function create_report_share");
      expect(source).toContain("not_authorized");
      expect(source).toContain("grant execute on function create_report_share(uuid, integer) to authenticated");
    }
  });
});
