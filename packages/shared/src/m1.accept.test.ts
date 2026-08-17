import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { describeInviteRedeemResult, isInviteRedeemSuccess, type InviteRedeemResult } from "./m1";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const freeze = readFileSync(
  new URL("../../../supabase/migrations/20260819000000_connection_identity_freeze.sql", import.meta.url),
  "utf8"
);
const strayGrants = readFileSync(
  new URL("../../../supabase/migrations/20260819010000_revoke_stray_client_grants.sql", import.meta.url),
  "utf8"
);
const accept = readFileSync(
  new URL("../../../supabase/migrations/20260819020000_accept_connection_atomic.sql", import.meta.url),
  "utf8"
);
const limit = readFileSync(
  new URL("../../../supabase/migrations/20260819030000_invite_attempt_limit.sql", import.meta.url),
  "utf8"
);
const teacherWeb = readFileSync(new URL("../../../apps/teacher/src/app/m1.tsx", import.meta.url), "utf8");
const studentApp = readFileSync(new URL("../../../apps/student/src/m1Screens.tsx", import.meta.url), "utf8");

// ── 초대 코드 결과 문구 ──────────────────────────────────────────────────────
describe("초대 코드 사용 결과 → 사용자 문구", () => {
  it("성공하면 저장된 상태를 알려 준다", () => {
    const result: InviteRedeemResult = {
      ok: true,
      reason: "created",
      connection: { id: "c1", status: "pending" }
    };
    expect(isInviteRedeemSuccess(result)).toBe(true);
    expect(describeInviteRedeemResult(result)).toContain("pending");
  });

  it("실패 사유마다 다른 문구를 준다 — 전부 같은 말이면 학생이 뭘 해야 할지 모른다", () => {
    const messages = (["invalid_format", "not_found", "already_used", "rate_limited"] as const).map((reason) =>
      describeInviteRedeemResult({ ok: false, reason })
    );
    expect(new Set(messages).size).toBe(4);
  });

  it("차단 문구에 남은 시간을 분으로 넣는다", () => {
    expect(describeInviteRedeemResult({ ok: false, reason: "rate_limited", retry_after_seconds: 540 })).toContain(
      "9분"
    );
    // 30초 남았다고 "0분" 이라고 하면 바로 다시 눌러서 또 막힌다.
    expect(describeInviteRedeemResult({ ok: false, reason: "rate_limited", retry_after_seconds: 30 })).toContain(
      "1분"
    );
  });

  it("retry_after_seconds 가 없어도 문구가 깨지지 않는다", () => {
    expect(describeInviteRedeemResult({ ok: false, reason: "rate_limited" })).toMatch(/\d+분/);
  });

  it("성공 결과에는 실패 문구가 섞이지 않는다", () => {
    const msg = describeInviteRedeemResult({
      ok: true,
      reason: "existing",
      connection: { id: "c1", status: "active" }
    });
    expect(msg).not.toContain("다시");
  });
});

// ── 연결 신원 컬럼 동결 (20260819000000) ─────────────────────────────────────
describe("연결 신원 컬럼 동결", () => {
  it("클라이언트의 connections UPDATE 를 status·activated_at 로만 제한한다", () => {
    for (const source of [freeze, schema]) {
      expect(source).toContain("revoke update on table connections from authenticated");
      expect(source).toContain("grant update (status, activated_at) on table connections to authenticated");
    }
  });

  it("신원 컬럼이 허용 목록에 없다 — 있으면 남의 학생을 붙일 수 있다", () => {
    const grant = freeze.slice(freeze.indexOf("grant update ("), freeze.indexOf("on table connections to authenticated"));
    for (const column of ["student_id", "teacher_id", "invite_code", "requested_by"]) {
      expect(grant, column).not.toContain(column);
    }
  });

  it("anon 에서도 회수한다 — public 회수만으로는 롤별 권한이 남는다", () => {
    expect(freeze).toContain("revoke update on table connections from anon");
  });
});

// ── 정책 0개 표의 잔여 권한 (20260819010000) ─────────────────────────────────
describe("정책 0개 표의 클라이언트 쓰기 권한 회수", () => {
  it("세 표 모두 회수한다", () => {
    for (const table of ["report_views", "storage_purge_log", "storage_purge_queue"]) {
      for (const source of [strayGrants, schema]) {
        expect(source, table).toContain(
          `revoke insert, update, delete, truncate on table ${table} from anon, authenticated`
        );
      }
    }
  });

  it("service_role 은 건드리지 않는다 — 큐 처리기가 그 권한으로 돈다", () => {
    // 주석 산문에도 service_role 이 나온다 → 실제 문장만 본다.
    const statements = strayGrants
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).toMatch(/revoke/);
    expect(statements).not.toContain("service_role");
  });
});

// ── 수락 원자화 (20260819020000) ─────────────────────────────────────────────
describe("연결 수락 RPC", () => {
  const fn = accept.slice(
    accept.indexOf("create or replace function accept_connection_request"),
    accept.indexOf("revoke all on function accept_connection_request")
  );

  it("한 함수 안에서 설정 생성과 상태 전이를 모두 한다", () => {
    expect(fn).toContain("insert into per_student_settings");
    expect(fn).toContain("set status = 'active'");
  });

  it("교사 본인만 — security definer 는 RLS 가 안 걸리므로 함수가 직접 확인해야 한다", () => {
    expect(fn).toContain("security definer");
    expect(fn).toContain("conn.teacher_id <> auth.uid()");
    expect(fn).toContain("not_connection_teacher");
  });

  it("행을 잠근다 — 동시에 두 번 눌러도 하나만 전이한다", () => {
    expect(fn).toContain("for update");
  });

  it("멱등이다 — 이미 active 면 오류가 아니라 같은 행을 돌려준다", () => {
    expect(fn).toContain("if conn.status = 'active' then");
    expect(fn).toContain("on conflict (connection_id) do nothing");
  });

  it("rejected·disconnected 를 수락으로 되살리지 않는다", () => {
    expect(fn).toContain("connection_not_pending");
  });

  it("기본값을 SQL 에 복제하지 않는다 — 두 곳에 적으면 갈라진다", () => {
    expect(fn).not.toContain("report_cycle");
    expect(fn).not.toContain("ai_check_subjects");
  });

  it("disclosure_settings 를 만들지 않는다 — 만들면 공개를 켜 주는 일이 된다", () => {
    expect(fn).not.toContain("disclosure_settings");
  });

  it("anon 은 실행할 수 없다", () => {
    expect(accept).toContain("revoke all on function accept_connection_request(uuid) from anon");
    expect(accept).toContain("grant execute on function accept_connection_request(uuid) to authenticated");
  });

  it("과외쌤 웹이 실제로 이 RPC 를 쓴다 — 안 쓰면 2단계 수락이 그대로 남는다", () => {
    expect(teacherWeb).toContain('supabase.rpc("accept_connection_request", { p_connection_id: connection.id })');
    // 옛 경로가 남아 있으면 안 된다: 수락 시 per_student_settings 를 클라이언트가 직접 만들던 코드.
    const decide = teacherWeb.slice(teacherWeb.indexOf("async function decide("), teacherWeb.indexOf("if (!rows.length)"));
    expect(decide).not.toContain("per_student_settings");
  });
});

// ── 초대 코드 시도 제한 (20260819030000) ─────────────────────────────────────
describe("초대 코드 시도 제한", () => {
  it("계정당 시도를 기록하는 표가 있다", () => {
    for (const source of [limit, schema]) {
      expect(source).toContain("create table if not exists invite_attempts");
      expect(source).toContain("invite_attempts_student_time_idx");
    }
  });

  it("입력한 코드 자체는 저장하지 않는다 — 운 좋게 맞힌 코드가 표에 남는다", () => {
    const table = limit.slice(limit.indexOf("create table if not exists invite_attempts"), limit.indexOf(");"));
    expect(table).not.toContain("code");
    expect(table).toContain("outcome");
  });

  it("클라이언트는 이 표를 직접 만질 수 없다 — 정책 0개 + 권한 회수", () => {
    expect(limit).toContain("alter table invite_attempts enable row level security");
    expect(limit).toContain("revoke all on table invite_attempts from anon");
    expect(limit).toContain("revoke all on table invite_attempts from authenticated");
    expect(limit).not.toMatch(/create policy \w+ on invite_attempts/);
  });

  it("임계값이 10분 10회다", () => {
    expect(limit).toMatch(/invite_attempt_window_minutes\(\) returns integer\s*\r?\nlanguage sql immutable as \$\$ select 10 \$\$/);
    expect(limit).toMatch(/invite_attempt_max_failures\(\) returns integer\s*\r?\nlanguage sql immutable as \$\$ select 10 \$\$/);
  });

  const fn = limit.slice(
    limit.indexOf("create function request_connection_by_invite"),
    limit.indexOf("revoke all on function request_connection_by_invite")
  );

  it("사용자 입력 실패를 예외로 던지지 않는다 — 던지면 시도 기록이 롤백된다", () => {
    for (const gone of ["invalid_invite_code", "invite_code_not_found", "invite_code_already_used"]) {
      expect(fn, gone).not.toContain(`raise exception '${gone}'`);
    }
    expect(fn).toContain("'reason', 'not_found'");
    expect(fn).toContain("'reason', 'already_used'");
    expect(fn).toContain("'reason', 'invalid_format'");
  });

  it("호출 자체가 잘못된 경우는 계속 예외다 — 셀 필요가 없다", () => {
    expect(fn).toContain("raise exception 'authentication_required'");
    expect(fn).toContain("raise exception 'student_profile_required'");
  });

  it("성공은 실패로 세지 않는다", () => {
    expect(fn).toContain("outcome <> 'success'");
  });

  it("차단된 시도는 기록하지 않는다 — 기록하면 두드리는 동안 영구 차단이 된다", () => {
    const blocked = fn.slice(fn.indexOf("if failures >= invite_attempt_max_failures()"), fn.indexOf("normalized_code :="));
    expect(blocked).not.toContain("insert into invite_attempts");
    expect(blocked).toContain("retry_after_seconds");
  });

  it("창 밖의 기록을 스스로 정리한다 — 스케줄러를 만들지 않는다", () => {
    expect(fn).toContain("delete from invite_attempts");
    expect(fn).toContain("attempted_at < window_start");
  });

  it("학생 앱이 reason 을 읽는다 — error 만 보면 실패를 성공으로 표시한다", () => {
    expect(studentApp).toContain("describeInviteRedeemResult");
    expect(studentApp).not.toContain("연결 요청이 ${connection.status} 상태로");
  });
});
