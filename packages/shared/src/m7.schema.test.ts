import { describe, expect, it } from "vitest";

import { readSource, sliceBetween } from "./testSource";

import { NOTIFICATION_EVENTS } from "./m7";
import { REPORT_QUOTA_FLOOR, REPORT_QUOTA_PER_STUDENT, reportMonthlyQuota } from "./parentReport";

const schema = readSource(new URL("../../../supabase/schema.sql", import.meta.url));
const migration = readSource(new URL("../../../supabase/migrations/20260627000000_m7_account_system.sql", import.meta.url));
const notifyMigration = readSource(new URL("../../../supabase/migrations/20260809000000_notification_events.sql", import.meta.url));

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

// ── 앱 내 알림 생성(20260809000000) ──────────────────────────────────────────
// notifications 테이블은 처음부터 있었지만 INSERT 하는 프로덕션 코드가 0건이었다.
// 두 앱의 알림 센터가 아무도 채우지 않는 테이블을 읽고 있었다.
describe("알림 생성 트리거 (shared ↔ schema ↔ migration)", () => {
  it("이벤트마다 트리거가 실제로 걸려 있다", () => {
    for (const source of [schema, notifyMigration]) {
      for (const trigger of [
        // 숙제 출제·제출·확인/반려·연동·리포트 — 클라이언트가 테이블에 직접 쓰는 경로라
        // 트리거로 덮는다. RPC 로 바꾸면 호출부를 빠뜨린 경로만 조용히 알림이 없어진다.
        "notify_teacher_homework_assigned_trigger on todos",
        "notify_homework_submitted_trigger on homework_submissions",
        "notify_homework_reviewed_trigger on homework_submissions",
        "notify_connection_change_trigger on connections",
        "notify_report_sent_trigger on reports"
      ]) {
        expect(source, trigger).toContain(`create trigger ${trigger.split(" on ")[0]}`);
        expect(source, trigger).toContain(trigger);
      }
    }
  });

  it("shared 의 이벤트 표와 마이그레이션 문구가 일치한다", () => {
    // 한쪽만 고치면 문서가 조용히 거짓이 된다 — 과외쌤 앱의 "알림이 가요" 문구가
    // 실제로 거짓이었던 전례가 있다.
    expect(NOTIFICATION_EVENTS.length).toBeGreaterThanOrEqual(8);
    for (const event of NOTIFICATION_EVENTS) {
      expect(notifyMigration, event.event).toContain(`'${event.title}'`);
      expect(notifyMigration, event.event).toContain(`'${event.type}',`);
    }
  });

  it("알림 실패가 원래 작업을 되돌리지 않는다", () => {
    // AFTER 트리거에서 예외가 나면 트랜잭션 전체가 롤백된다.
    // 알림 버그로 숙제 출제가 실패하는 것은 받아들일 수 없다.
    const handlers = [...notifyMigration.matchAll(/exception when others then/g)];
    expect(handlers.length).toBeGreaterThanOrEqual(5);
    // 조용히 죽지는 않는다 — 로그에는 남긴다.
    expect(notifyMigration).toContain("raise warning");
  });

  it("알림 생성은 서버 권위적이다 — 클라이언트가 남의 알림을 못 만든다", () => {
    for (const source of [schema, notifyMigration]) {
      expect(source).toContain("create or replace function emit_notification");
      expect(source).toContain("security definer");
      expect(source).toMatch(/revoke all on function emit_notification\([^)]*\) from authenticated/);
    }
    // authenticated 에 grant 가 있으면 클라이언트가 임의 알림을 만들 수 있다.
    expect(notifyMigration).not.toMatch(/grant execute on function emit_notification\([^)]*\) to authenticated/);
  });

  it("자기 자신에게는 알리지 않는다", () => {
    expect(notifyMigration).toContain("if p_user_id = auth.uid() then");
  });
});

// ── 회원 탈퇴를 막는 FK (20260809010000 · 20260809020000) ────────────────────
// 과외쌤이 숙제를 한 번이라도 내면 delete_my_account() 가 23503 으로 실패했다.
// 화면까지 도달하게 만들어도 RPC 가 실패하면 고쳐진 게 아니다.
describe("회원 탈퇴를 막지 않는 FK", () => {
  const fkMigrations = [
    readSource(new URL("../../../supabase/migrations/20260809010000_account_deletion_fk_fix.sql", import.meta.url)),
    readSource(new URL("../../../supabase/migrations/20260809020000_account_deletion_fk_fix_2.sql", import.meta.url))
  ].join("\n");

  it("profiles 를 참조하는 감사용 FK 는 전부 SET NULL 이다", () => {
    // CASCADE 로 두면 과외쌤 한 명의 탈퇴가 **학생의** 숙제·리포트를 지운다.
    // 한 사용자의 탈퇴가 다른 사용자의 데이터를 지우면 안 된다.
    for (const [table, column] of [
      ["todos", "created_by"],
      ["connections", "requested_by"],
      ["reports", "teacher_id"],
      ["invite_codes", "used_by"]
    ]) {
      expect(fkMigrations, `${table}.${column}`).toContain(
        `foreign key (${column}) references profiles(id) on delete set null`
      );
      expect(schema, `${table}.${column}`).toMatch(
        new RegExp(`${column}\\s+uuid[^,\\n]*references profiles\\(id\\) on delete set null`)
      );
    }
  });

  it("탈퇴하면 Storage 사진 정리가 대기열에 반드시 남는다", () => {
    // delete_my_account 는 DB 만 지운다. Storage 파일은 Postgres 트랜잭션에서 못 지운다.
    // Edge Function 을 안 거치고 RPC 만 불러도 트리거가 대기열에 남겨야 조용히 새지 않는다.
    const purge = readSource(new URL("../../../supabase/migrations/20260810000000_account_storage_purge.sql", import.meta.url));
    for (const source of [schema, purge]) {
      expect(source).toContain("create table if not exists storage_purge_queue");
      expect(source).toContain("create trigger enqueue_storage_purge_on_profile_delete_trigger");
      expect(source).toContain("before delete on profiles");
      // 대기열이 profiles 를 참조하면 계정과 함께 사라져서 존재 의미가 없다.
      // (notifications 등 다른 테이블에는 그 FK 가 정상적으로 있으므로 이 표 안에서만 본다.)
      const table = sliceBetween(
        source,
        "create table if not exists storage_purge_queue",
        "create index if not exists storage_purge_queue_pending_idx"
      );
      expect(table.length).toBeGreaterThan(100);
      expect(table).not.toMatch(/references\s+profiles/);
      // 남의 파일을 지우지 않는 유일한 기준 — DB 에서 강제한다.
      expect(source).toContain("check (prefix = user_id::text || '/')");
      // 조회·기록 함수는 service_role 전용이어야 한다.
      for (const fn of ["storage_paths_for_prefix", "complete_storage_purge"]) {
        expect(source, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from authenticated`));
        expect(source, fn).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to service_role`));
      }
    }
    // 클라이언트가 대기열을 읽거나 쓰면 탈퇴한 사용자의 흔적이 노출된다 → 정책 0개.
    expect(schema).toContain("alter table storage_purge_queue enable row level security");
    expect(schema).not.toMatch(/create policy \w+ on storage_purge_queue/);
  });

  it("탈퇴 화면이 RPC 를 직접 부르지 않는다 — 부르면 사진이 남는다", () => {
    const fn = readSource(new URL("../../../supabase/functions/account-delete/index.ts", import.meta.url));
    // 파일 → 계정 순서. 그리고 계정 삭제는 **호출자 권한**이어야 auth.uid() 가 맞는다.
    expect(fn).toContain('asUser.rpc("delete_my_account")');
    expect(fn).toContain("assertScoped");
    expect(fn).toContain("scope_violation");

    for (const [label, path] of [
      ["학생", "../../../apps/student/src/m7Screens.tsx"],
      ["과외쌤", "../../../apps/teacher/src/app/m7.tsx"]
    ] as const) {
      const screen = readSource(new URL(path, import.meta.url));
      expect(screen, label).toContain('supabase.functions.invoke("account-delete"');
      expect(screen, label).not.toContain('supabase.rpc("delete_my_account")');
    }
  });

  it("todos.created_by 의 NOT NULL 을 푼다 — 안 풀면 SET NULL 을 걸 수 없다", () => {
    expect(fkMigrations).toContain("alter table todos alter column created_by drop not null");
    expect(schema).not.toMatch(/created_by\s+uuid not null references profiles/);
  });
});

// ── 수업 회차 · 발급 한도 (20260815020000) ───────────────────────────────────
describe("수업 회차와 리포트 발급 한도", () => {
  const lessonsMigration = readSource(new URL("../../../supabase/migrations/20260815020000_lessons_and_report_quota.sql", import.meta.url));

  it("회차는 exam_records 와 같은 원칙으로 막는다 — teacher_id + active 연결", () => {
    for (const source of [schema, lessonsMigration]) {
      expect(source).toContain("create table if not exists lessons");
      expect(source).toContain("create policy lessons_teacher_rw on lessons");
      // teacher_id 만 보면 남의 학생 id 로 행을 만들 수 있다.
      expect(source).toMatch(/lessons_teacher_rw[\s\S]*?c\.status = 'active'/);
      expect(source).toContain("check (status in ('done', 'absent', 'canceled'))");
    }
  });

  it("한도 규칙이 TS 상수와 DB 함수에서 같다", () => {
    // 화면 계산만 있으면 PostgREST 직접 호출로 우회된다 → DB 트리거가 최종 방어선이다.
    expect(lessonsMigration).toContain(`select ${REPORT_QUOTA_PER_STUDENT}`);
    expect(lessonsMigration).toContain(`select ${REPORT_QUOTA_FLOOR}`);
    expect(schema).toContain(`select ${REPORT_QUOTA_PER_STUDENT}`);
    expect(schema).toContain(`select ${REPORT_QUOTA_FLOOR}`);
    // 하한 + 학생수×단가 구조가 양쪽에서 같아야 한다.
    expect(lessonsMigration).toContain("greatest(");
    expect(reportMonthlyQuota(12)).toBe(12 * REPORT_QUOTA_PER_STUDENT);
    expect(reportMonthlyQuota(1)).toBe(REPORT_QUOTA_FLOOR);
  });

  it("한도는 DB 에서 강제된다", () => {
    for (const source of [schema, lessonsMigration]) {
      expect(source).toContain("create trigger enforce_report_quota_trigger");
      expect(source).toContain("before insert on reports");
      expect(source).toContain("report_monthly_quota_exceeded");
      // 학생 본인 리포트(teacher_id 없음)는 이 한도의 대상이 아니다.
      expect(source).toContain("if new.teacher_id is null then");
    }
  });
});
