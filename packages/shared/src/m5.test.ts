import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AD_UNLOCK_ENABLED } from "./featureFlags";

import {
  aggregateWeeklyStudy,
  createPlannerTodosFromRecommendation,
  getFeatureGateState,
  getSharedReportStatusCopy,
  getStubReportDraft,
  getStubStudyRecommendation,
  isShareExpired
} from "./m5";

describe("M5 study recommendation stub", () => {
  it("recommends +2h over recent hours, clamped 2..15, deterministic", () => {
    const recs = getStubStudyRecommendation({
      recentMinutesBySubject: { math: 180, english: 0 },
      subjects: ["math", "english"]
    });
    expect(recs).toEqual([
      { subject: "math", recommendedHours: 5, reason: expect.stringContaining("최근 주 3시간") },
      { subject: "english", recommendedHours: 2, reason: expect.stringContaining("최근 주 0시간") }
    ]);
    expect(getStubStudyRecommendation({ recentMinutesBySubject: { math: 180 }, subjects: ["math"] })).toEqual(recs.slice(0, 1));
  });
});

describe("M5 weekly aggregate for report charts", () => {
  it("buckets minutes by day and subject within the week", () => {
    const weekStart = "2026-06-21"; // Sunday
    const aggregate = aggregateWeeklyStudy(
      [
        { subject: "math", duration_sec: 3600, started_at: "2026-06-21T10:00:00.000Z" },
        { subject: "math", duration_sec: 1800, started_at: "2026-06-22T10:00:00.000Z" },
        { subject: "english", duration_sec: 3600, started_at: "2026-06-22T12:00:00.000Z" },
        { subject: "math", duration_sec: 3600, started_at: "2026-07-01T12:00:00.000Z" } // out of week
      ],
      weekStart
    );
    expect(aggregate.totalMinutes).toBe(150);
    expect(aggregate.perDayMinutes).toEqual([60, 90, 0, 0, 0, 0, 0]);
    expect(aggregate.perSubjectMinutes).toEqual([
      { subject: "math", minutes: 90 },
      { subject: "english", minutes: 60 }
    ]);
  });
});

describe("M5 report draft stub", () => {
  it("summarizes hours and completion deterministically", () => {
    const draft = getStubReportDraft({ studentName: "지민", totalMinutes: 150, topSubject: "math", completionRate: 0.8 });
    expect(draft).toContain("2시간 30분");
    expect(draft).toContain("80%");
    expect(draft).toContain("수학");
  });
});

describe("M5 feature gating (free=ad unlock / premium=unlimited)", () => {
  it("premium is always unlocked", () => {
    const active = { status: "active" as const, expires_at: "2099-01-01T00:00:00.000Z" };
    expect(getFeatureGateState({ feature: "report", subscription: active, unlocks: [] })).toMatchObject({
      unlocked: true,
      canUnlockByAd: false
    });
  });

  it("free user is locked until an active ad unlock exists", () => {
    const now = "2026-06-23T00:00:00.000Z";
    expect(getFeatureGateState({ feature: "ai_rec", subscription: null, unlocks: [], now })).toMatchObject({
      unlocked: false,
      canUnlockByAd: true
    });
    expect(
      getFeatureGateState({
        feature: "ai_rec",
        subscription: null,
        unlocks: [{ feature: "ai_rec", expires_at: "2026-06-24T00:00:00.000Z" }],
        now
      })
    ).toMatchObject({ unlocked: true, canUnlockByAd: false });
    expect(
      getFeatureGateState({
        feature: "ai_rec",
        subscription: null,
        unlocks: [{ feature: "ai_rec", expires_at: "2026-06-22T00:00:00.000Z" }],
        now
      })
    ).toMatchObject({ unlocked: false });
  });

  // 원래 구멍: 호출부가 `status === "active"` 만 넘겨 만료된 구독이 프리미엄으로 통과했다.
  // 이제 게이트가 구독 행을 받아 직접 판정하므로 그 실수를 만들 수 없다.
  it("does not treat an expired subscription as premium", () => {
    expect(
      getFeatureGateState({
        feature: "ai_check",
        subscription: { status: "active", expires_at: "2026-08-05T00:00:00.000Z" },
        unlocks: [],
        now: "2026-08-06T00:00:00.000Z"
      })
    ).toMatchObject({ unlocked: false, isPremium: false });
  });

  // expires_at 이 비면 "만료일을 모르는 구독"이다 → fail-closed(권리 없음).
  // DB 의 `expires_at > now()` 가 NULL 에 false 인 것과 같은 규칙이어야 한다.
  it("treats a missing expiry as no entitlement (fail-closed, matches the DB rule)", () => {
    expect(
      getFeatureGateState({ feature: "ai_check", subscription: { status: "active", expires_at: null }, unlocks: [] })
    ).toMatchObject({ isPremium: false });
  });

  it("rejects every non-active status regardless of expiry", () => {
    for (const status of ["past_due", "paused", "canceled", "none"] as const) {
      expect(
        getFeatureGateState({
          feature: "ai_check",
          subscription: { status, expires_at: "2099-01-01T00:00:00.000Z" },
          unlocks: []
        }),
        status
      ).toMatchObject({ isPremium: false });
    }
  });
});

describe("M5 share link expiry + status copy", () => {
  it("treats past expiry as expired and null as never-expiring", () => {
    const now = "2026-06-23T00:00:00.000Z";
    expect(isShareExpired("2026-06-22T00:00:00.000Z", now)).toBe(true);
    expect(isShareExpired("2026-06-24T00:00:00.000Z", now)).toBe(false);
    expect(isShareExpired(null, now)).toBe(false);
  });

  it("maps shared report status to parent-facing copy", () => {
    expect(getSharedReportStatusCopy("expired").title).toContain("만료");
    expect(getSharedReportStatusCopy("not_found").title).toContain("찾을 수 없");
    expect(getSharedReportStatusCopy("ok").title).toBe("주간 리포트");
  });
});

describe("M5 plan reflection", () => {
  it("turns recommendations into self todos", () => {
    const todos = createPlannerTodosFromRecommendation(
      [{ subject: "math", recommendedHours: 5, reason: "x" }],
      "student-1",
      "2026-06-30"
    );
    expect(todos).toEqual([
      {
        student_id: "student-1",
        title: "수학 주 5시간 공부",
        subject: "math",
        source: "self",
        ai_check_enabled: false,
        due_date: "2026-06-30",
        created_by: "student-1"
      }
    ]);
  });
});

// ── 학부모 웹뷰의 공유 링크 보안 (20260815030000) ────────────────────────────
// 학부모는 가입하지 않는다. 접근 통제가 **토큰 하나**에 달려 있어서, 여기가 무너지면
// 남의 아이 리포트가 열린다.
describe("공유 링크 — 토큰·만료·회수", () => {
  const migration = readFileSync(
    new URL("../../../supabase/migrations/20260815030000_parent_webview_share.sql", import.meta.url),
    "utf8"
  );
  const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../../../apps/teacher/src/app/m5.tsx", import.meta.url), "utf8");
  const webview = readFileSync(
    new URL("../../../apps/teacher/src/app/r/[token]/page.tsx", import.meta.url),
    "utf8"
  );
  const webviewLayout = readFileSync(
    new URL("../../../apps/teacher/src/app/r/[token]/layout.tsx", import.meta.url),
    "utf8"
  );

  it("토큰은 UUID 두 개를 이어 붙인 64자다 — 무작위 대입이 불가능하다", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain(
        "replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')"
      );
    }
  });

  it("없는 토큰과 미발송 리포트를 같은 응답으로 합친다 — 토큰 존재 여부가 새면 안 된다", () => {
    for (const source of [migration, schema]) {
      expect(source).toMatch(/if not found or report_row\.status <> 'sent' then[\s\S]{0,120}'not_found'/);
    }
  });

  it("만료 기본값은 90일이고 화면이 그걸 덮어쓰지 않는다", () => {
    // 168시간(7일)로 되돌리면 학부모가 늦게 열었을 때 링크가 죽는다.
    for (const source of [migration, schema]) {
      expect(source).toContain("p_ttl_hours integer default 2160");
    }
    expect(screen).toContain('supabase.rpc("create_report_share", { p_report_id: reportId })');
    expect(screen).not.toContain("p_ttl_hours: 168");
  });

  it("회수 수단이 있고 화면에서 도달 가능하다", () => {
    // 함수만 만들고 버튼이 없으면 유출 시 만료를 기다리는 것 말고 할 수 있는 게 없다.
    for (const source of [migration, schema]) {
      expect(source).toContain("create or replace function revoke_report_share");
      expect(source).toContain("revoke all on function revoke_report_share(uuid) from anon");
      expect(source).toContain("grant execute on function revoke_report_share(uuid) to authenticated");
    }
    expect(screen).toContain('supabase.rpc("revoke_report_share"');
    expect(screen).toContain("링크 끊기");
  });

  it("조회 함수만 anon 에게 열려 있다 — 테이블 직접 접근 경로는 없다", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("grant execute on function get_shared_report(text) to anon, authenticated");
    }
    // reports 에 anon 정책이 생기면 토큰 없이도 읽히기 시작한다.
    expect(schema).not.toMatch(/create policy \w+ on reports for select to anon/);
  });

  it("웹뷰는 스냅샷만 읽는다 — 실시간 테이블을 다시 조회하지 않는다", () => {
    expect(webview).toContain('supabase.rpc("get_shared_report"');
    expect(webview).not.toMatch(/supabase\s*\.from\(/);
  });

  it("공개 URL 이 색인되거나 Referer 로 새지 않는다", () => {
    // 한 번 색인되면 토큰을 몰라도 검색으로 도달한다 — 만료 정책이 무의미해진다.
    expect(webviewLayout).toContain("index: false");
    expect(webviewLayout).toContain("noarchive: true");
    expect(webviewLayout).toContain('referrer: "no-referrer"');
  });
});

// ── 광고 보상 언락 실패-폐쇄 (20260816010000) ────────────────────────────────
// A0 감사에서 ad_unlocks 정책이 for all 이라 학생이 광고를 보지 않고 스스로 언락을
// 발급할 수 있음이 확인됐다. 유료 게이트가 이 표 한 줄로 열린다.
describe("광고 보상 언락 — 발급 차단", () => {
  const migration = readFileSync(
    new URL("../../../supabase/migrations/20260816010000_ad_unlocks_fail_closed.sql", import.meta.url),
    "utf8"
  );
  const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../../../apps/student/src/m5Screens.tsx", import.meta.url), "utf8");

  it("for all 정책이 사라졌다", () => {
    expect(migration).toContain("drop policy if exists unlock_self on ad_unlocks");
    expect(schema).not.toContain("create policy unlock_self on ad_unlocks for all");
  });

  it("SELECT 만 남기고 쓰기 정책은 아예 없다 — RLS 기본 거부가 최종 방어선이다", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("create policy ad_unlocks_select_self on ad_unlocks");
      expect(source).toContain("for select to authenticated");
      // 쓰기 정책을 만들어 두면 조건을 완화하는 실수로 곧바로 열린다.
      expect(source).not.toMatch(/create policy \w+ on ad_unlocks[\s\S]{0,80}for (insert|update|delete|all)/);
    }
  });

  it("테이블 권한도 회수한다 — 정책만 고치면 정책 추가 시 곧바로 열린다", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("revoke all on table ad_unlocks from anon");
      expect(source).toMatch(/revoke insert, update, delete[^;]*on table ad_unlocks from authenticated/);
    }
  });

  it("클라이언트 광고 버튼도 함께 숨긴다 — 서버만 막으면 눌러도 실패하는 버튼이 된다", () => {
    expect(AD_UNLOCK_ENABLED).toBe(false);
    expect(screen).toContain("AD_UNLOCK_ENABLED && gate.canUnlockByAd");
  });
});
