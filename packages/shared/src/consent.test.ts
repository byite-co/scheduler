import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CONSENT_DOCUMENTS,
  CONSENT_DOCUMENT_VERSION,
  REQUIRED_CONSENT_DOCUMENTS,
  buildConsentRows,
  canProceedWithConsent,
  hasCurrentConsent
} from "./consent";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260818010000_consent_records.sql", import.meta.url),
  "utf8"
);
const teacherWeb = readFileSync(new URL("../../../apps/teacher/src/app/m1.tsx", import.meta.url), "utf8");
const studentApp = readFileSync(new URL("../../../apps/student/src/m1Screens.tsx", import.meta.url), "utf8");

describe("약관 동의 — 필수 항목 게이트", () => {
  it("필수 두 개가 다 체크돼야 진행할 수 있다", () => {
    expect(canProceedWithConsent({})).toBe(false);
    expect(canProceedWithConsent({ terms_of_service: true })).toBe(false);
    expect(canProceedWithConsent({ terms_of_service: true, privacy_policy: true })).toBe(true);
  });

  it("선택 항목은 진행을 막지 않는다", () => {
    expect(
      canProceedWithConsent({ terms_of_service: true, privacy_policy: true, marketing_optional: false })
    ).toBe(true);
  });

  it("필수 목록에 마케팅이 들어가면 안 된다 — 선택을 필수로 만드는 것은 위법이다", () => {
    expect(REQUIRED_CONSENT_DOCUMENTS).not.toContain("marketing_optional");
    expect(REQUIRED_CONSENT_DOCUMENTS).toEqual(["terms_of_service", "privacy_policy"]);
  });
});

describe("약관 동의 — 기록 페이로드", () => {
  it("체크한 것만 행을 만든다", () => {
    const rows = buildConsentRows("u1", { terms_of_service: true, privacy_policy: true }, "signup");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.document).sort()).toEqual(["privacy_policy", "terms_of_service"]);
  });

  it("선택 항목을 체크했으면 그것도 남긴다", () => {
    const rows = buildConsentRows(
      "u1",
      { terms_of_service: true, privacy_policy: true, marketing_optional: true },
      "signup"
    );
    expect(rows).toHaveLength(3);
  });

  it("체크하지 않은 항목은 '거절' 행을 만들지 않는다 — 행이 없는 것이 미동의다", () => {
    const rows = buildConsentRows("u1", { terms_of_service: true }, "signup");
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.action === "accepted")).toBe(true);
  });

  it("주체는 항상 self 다 — 보호자 동의는 클라이언트가 만들 수 없다", () => {
    // RLS 정책도 with check (subject = 'self') 로 같은 규칙을 강제한다.
    const rows = buildConsentRows("u1", { terms_of_service: true, privacy_policy: true }, "signup");
    expect(rows.every((r) => r.subject === "self")).toBe(true);
  });

  it("버전을 함께 남긴다 — 없으면 '무엇에 동의했는지' 를 잃는다", () => {
    const rows = buildConsentRows("u1", { terms_of_service: true }, "signup");
    expect(rows[0].version).toBe(CONSENT_DOCUMENT_VERSION);
    expect(buildConsentRows("u1", { terms_of_service: true }, "signup", "v1")[0].version).toBe("v1");
  });
});

describe("약관 동의 — 현재 버전 판정", () => {
  it("필수 문서가 현재 버전으로 accepted 여야 참이다", () => {
    const ok = [
      { document: "terms_of_service", version: CONSENT_DOCUMENT_VERSION, action: "accepted" },
      { document: "privacy_policy", version: CONSENT_DOCUMENT_VERSION, action: "accepted" }
    ];
    expect(hasCurrentConsent(ok)).toBe(true);
    expect(hasCurrentConsent(null)).toBe(false);
    expect(hasCurrentConsent(ok.slice(0, 1))).toBe(false);
  });

  it("옛 버전 동의는 현재 동의가 아니다 — 문안이 바뀌면 다시 받아야 한다", () => {
    expect(
      hasCurrentConsent([
        { document: "terms_of_service", version: "old", action: "accepted" },
        { document: "privacy_policy", version: "old", action: "accepted" }
      ])
    ).toBe(false);
  });

  it("철회한 문서는 동의로 세지 않는다", () => {
    expect(
      hasCurrentConsent([
        { document: "terms_of_service", version: CONSENT_DOCUMENT_VERSION, action: "withdrawn" },
        { document: "privacy_policy", version: CONSENT_DOCUMENT_VERSION, action: "accepted" }
      ])
    ).toBe(false);
  });
});

// ── 증적 표의 불변식 (20260818010000) ────────────────────────────────────────
describe("consent_records 스키마", () => {
  it("append-only — UPDATE·DELETE 정책이 없다", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("create policy consent_records_select_self on consent_records");
      expect(source).toContain("create policy consent_records_insert_self on consent_records");
      // 동의를 고쳐 쓸 수 있으면 증적이 아니다.
      expect(source).not.toMatch(/create policy \w+ on consent_records[\s\S]{0,80}for (update|delete|all)/);
      expect(source).toContain("revoke update, delete, truncate, references on table consent_records from authenticated");
      expect(source).toContain("revoke all on table consent_records from anon");
    }
  });

  it("본인 행만, 주체는 self 만 삽입할 수 있다", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("with check (user_id = auth.uid() and subject = 'self')");
    }
  });

  it("동의 주체 컬럼이 열려 있다 — 보호자 동의를 나중에 붙일 수 있어야 한다", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("subject      text not null default 'self'");
      expect(source).toContain("check (subject in ('self', 'guardian'))");
    }
  });

  it("문서 종류와 버전이 코드 상수와 일치한다", () => {
    for (const doc of CONSENT_DOCUMENTS) {
      expect(migration, doc).toContain(`'${doc}'`);
    }
  });
});

describe("가입 플로우가 동의를 실제로 기록한다", () => {
  it("과외쌤 웹: 필수 동의 없이 가입을 진행할 수 없다", () => {
    // 버튼 잠금 + 제출 시 재확인 두 겹.
    expect(teacherWeb).toContain("<SubmitButton disabled={mode === \"signup\" && !consentOk}>");
    expect(teacherWeb).toContain('if (mode === "signup" && !consentOk)');
    expect(teacherWeb).toContain("ConsentChecklist");
  });

  it("과외쌤 웹: 세션이 있으면 즉시, 없으면 온보딩에서 기록한다", () => {
    expect(teacherWeb).toContain('buildConsentRows(result.data.session.user.id, consent, "teacher_web_signup")');
    expect(teacherWeb).toContain('buildConsentRows(data.session.user.id, stashed, "teacher_web_onboarding")');
  });

  it("학생 앱: 가입 완료 시 동의를 기록한다", () => {
    expect(studentApp).toContain('buildConsentRows(data.session.user.id, selection, "student_app_signup")');
    // 이미 기록됐으면 중복을 만들지 않는다.
    expect(studentApp).toContain("hasCurrentConsent");
  });
});
