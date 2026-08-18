import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const consentMig = readFileSync(
  new URL("../../../supabase/migrations/20260821000000_onboarding_consent_atomic.sql", import.meta.url),
  "utf8"
);
const publishMig = readFileSync(
  new URL("../../../supabase/migrations/20260821010000_publish_report_atomic.sql", import.meta.url),
  "utf8"
);
const studentApp = readFileSync(new URL("../../../apps/student/src/m1Screens.tsx", import.meta.url), "utf8");
const teacherM1 = readFileSync(new URL("../../../apps/teacher/src/app/m1.tsx", import.meta.url), "utf8");
const teacherM5 = readFileSync(new URL("../../../apps/teacher/src/app/m5.tsx", import.meta.url), "utf8");
const studentM7 = readFileSync(new URL("../../../apps/student/src/m7Screens.tsx", import.meta.url), "utf8");

/** `profiles` upsert 의 인자 객체만 떼어 온다(주석·주변 코드 제외). */
function upsertArgs(source: string): string {
  const start = source.indexOf('supabase.from("profiles").upsert({');
  if (start < 0) throw new Error("profiles upsert 를 찾지 못했다");
  const end = source.indexOf("});", start);
  return source.slice(start, end);
}

/**
 * 줄 주석(`//`, `--`)을 걷어낸다 — 산문에 걸려 오탐하는 것을 막는다.
 * 이 함정에 세 번 걸렸다: 주석이 코드와 같은 문장을 설명하면 문자열 단정이 주석을 잡는다.
 */
function codeOnly(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith("//") && !t.startsWith("--");
    })
    .join("\n");
}

describe("R3 동의 원자화", () => {
  it("미러와 마이그레이션에 RPC 가 있고 authenticated 만 실행한다", () => {
    for (const source of [consentMig, schema]) {
      expect(source).toContain("create or replace function finish_onboarding_with_consent");
    }
    expect(consentMig).toContain("revoke all on function finish_onboarding_with_consent(text[], text, text) from anon");
    expect(consentMig).toContain(
      "grant execute on function finish_onboarding_with_consent(text[], text, text) to authenticated"
    );
  });

  it("필수 문서가 없으면 거부한다 — onboarded 를 켜지 않는다", () => {
    expect(consentMig).toContain("consent_required_missing");
    // 거부가 update 보다 앞에 있어야 한다(뒤에 있으면 이미 켜진 뒤 거부다).
    expect(consentMig.indexOf("consent_required_missing")).toBeLessThan(
      consentMig.indexOf("set onboarded = true")
    );
  });

  it("unnest 별칭에 컬럼 이름을 명시한다 — 맨 별칭은 상관 서브쿼리에서 행 전체로 해석될 수 있다", () => {
    // 실제로 이 버그를 겪었다: `unnest(required) r` + `c.document = r` 이 조용히 never-match 였다.
    // 주석에 나쁜 예(`unnest(required) r`)를 적어 두었으므로 **코드만** 본다.
    const code = codeOnly(consentMig);
    expect(code).toContain("unnest(required) as req(doc)");
    expect(code).toContain("c.document = req.doc");
    expect(code).not.toMatch(/unnest\(required\)\s+r\b/);
  });

  it("학생·과외쌤 화면이 onboarded 를 직접 켜지 않는다", () => {
    // 프로필 upsert 의 **인자 객체**만 본다. 창을 넓게 잡으면 주석의 "onboarded=true" 라는
    // 산문에 걸려 오탐이 난다(A5.1 에서 같은 함정을 겪었다 — 주석은 코드가 아니다).
    expect(upsertArgs(studentApp), "학생 프로필 저장이 onboarded 를 직접 켠다").not.toContain("onboarded");
    expect(studentApp).toContain("finish_onboarding_with_consent");

    expect(upsertArgs(teacherM1), "과외쌤 프로필 저장이 onboarded 를 직접 켠다").not.toContain("onboarded");
    expect(teacherM1).toContain("finish_onboarding_with_consent");
  });

  it("RPC 실패 시 화면이 넘어가지 않는다", () => {
    expect(studentApp).toContain("동의 기록에 실패해서 가입을 마치지 못했어요");
    expect(teacherM1).toContain("동의 기록에 실패해서 온보딩을 마치지 못했어요");
  });

  it("가입 시점 동의 기록의 error 를 읽는다", () => {
    // 예전에는 insert 결과를 버렸다.
    expect(teacherM1).toContain("if (recorded.error)");
    expect(teacherM1).toContain("writeTeacherConsent(consent)");
  });
});

describe("R3 리포트 발송 원자화", () => {
  it("미러와 마이그레이션에 publish_report 가 있다", () => {
    for (const source of [publishMig, schema]) {
      expect(source).toContain("create or replace function publish_report");
    }
    expect(publishMig).toContain("from anon");
    expect(publishMig).toContain("to authenticated");
  });

  it("네 단계가 한 함수 안에 있다", () => {
    expect(publishMig).toContain("insert into reports");
    expect(publishMig).toContain("set share_token = new_token");
    expect(publishMig).toContain("status = 'sent'");
    expect(publishMig).toContain("insert into report_deliveries");
  });

  it("active 연결과 코멘트를 서버가 요구한다", () => {
    expect(publishMig).toContain("not_connected_student");
    expect(publishMig).toContain("teacher_comment_required");
    expect(publishMig).toContain("invalid_delivery_channel");
  });

  it("연동 전 채널은 토큰을 발급하지 않는다", () => {
    const fn = publishMig.slice(publishMig.indexOf("if p_channel = 'link' then"), publishMig.indexOf("return jsonb_build_object"));
    expect(fn).toContain("delivery_status := 'pending'");
  });

  it("화면이 RPC 하나만 부른다 — 옛 4단계 잔재가 없다", () => {
    const send = teacherM5.slice(teacherM5.indexOf("async function saveAndSend"), teacherM5.indexOf("await loadStudent(studentId);\n  }"));
    expect(send).toContain('supabase.rpc("publish_report"');
    // 옛 경로: reports insert → create_report_share → status 업데이트 → deliveries insert
    expect(send).not.toContain('from("reports")');
    expect(send).not.toContain("create_report_share");
    expect(send).not.toContain('from("report_deliveries")');
  });

  it("성공 메시지는 RPC 성공 확인 뒤에만 나온다", () => {
    expect(teacherM5).toContain("발송 실패(아무것도 저장되지 않았어요)");
    expect(teacherM5.indexOf("if (published.error)")).toBeLessThan(
      teacherM5.indexOf("리포트를 저장하고 공유 링크를 발급했어요")
    );
  });
});

describe("R3 조회 실패를 '기록 없음' 으로 정규화하지 않는다", () => {
  it("빌더가 조회 오류를 네 번째 상태로 세운다", () => {
    expect(teacherM5).toContain("const [dataError, setDataError] = useState<string | null>(null)");
    expect(teacherM5).toContain("setDataError(failures.length ? failures.join(\", \") : null)");
  });

  it("조회 실패 상태에서는 발송 버튼이 막힌다", () => {
    expect(teacherM5).toContain("dataError !== null");
    expect(teacherM5).toContain("데이터를 불러오지 못해서 보낼 수 없어요");
  });
});

describe("R3 성공 선표시·fail-open 정리", () => {
  it("푸시 토큰 등록 성공을 확인한 뒤에만 granted 로 바꾼다", () => {
    const enable = studentM7.slice(studentM7.indexOf("async function enable()"), studentM7.indexOf("return (\n    <ScrollView"));
    // 실패 시 조기 반환이 setStatus 보다 앞에 있어야 한다.
    expect(enable.indexOf("알림을 켜지 못했어요")).toBeLessThan(enable.indexOf('setStatus("granted")'));
  });

  it("app_config 조회 실패를 '정상' 으로 바꾸지 않는다", () => {
    expect(studentM7).toContain("const [loadError, setLoadError] = useState<string | null>(null)");
    expect(studentM7).toContain("상태를 확인할 수 없어요");
    // 게이트를 fail-closed 로 만드는 게 아니라 오류를 보이게 하는 것이다 — 재시도가 있어야 한다.
    expect(studentM7).toContain("다시 확인");
  });
});
