-- A5.1 — OLD-불가시성 클래스 ②: 컬럼 권한·정책으로 막는 것.
--
-- 클라이언트가 실제로 쓰는 컬럼을 먼저 확인하고, 그것만 남긴다.

-- ── ① reports: 공유 토큰과 귀속 컬럼을 클라이언트가 못 쓰게 한다 ────────────
--
-- 실측 두 건:
--   · 교사가 `share_token = 'ATTACKER'`, `share_expires_at = now()+100년` 으로 덮어썼다.
--     공유 토큰은 **로그인 없이 열리는 학부모 리포트의 유일한 자격증명**이다. 추측 가능한
--     값으로 바꾸면 그 학생의 리포트가 공개된다. 학생은 교사에게 동의한 것이지 세상에 동의한
--     것이 아니다.
--   · 교사가 `student_id` 를 **연결이 없는 학생**으로 바꿨다. 정책의 with check 가
--     `teacher_id = auth.uid() OR <active 연결>` 이라 첫 가지만으로 통과한다.
--     A 학생 리포트를 B 학생 것으로 갈아 끼울 수 있고, 위의 토큰 지정과 합치면 동의하지 않은
--     학생 이름의 리포트를 공개할 수 있다.
--
-- 클라이언트가 reports 에 실제로 쓰는 UPDATE 컬럼은 두 개뿐이다:
--     apps/teacher/src/app/m5.tsx:445   .update({ status: "sent", sent_at: ... })
-- 나머지는 INSERT 시점에만 넣는다(INSERT 는 컬럼 권한과 무관하므로 그대로 동작한다).
-- share_token 은 create_report_share / revoke_report_share(둘 다 security definer)가 만든다
-- — definer 는 소유자 권한으로 돌아 이 회수에 영향받지 않는다(실측 확인).
revoke update on table reports from authenticated;
revoke update on table reports from anon;
grant update (status, sent_at) on table reports to authenticated;

-- ── ② invite_codes: 클라이언트는 발급만 한다 ────────────────────────────────
--
-- 실측: 교사가 `used_by` 를 임의 학생으로 바꿨다. used_by 는
-- request_connection_by_invite 가 "이미 다른 학생이 쓴 코드" 를 판정하는 근거다.
-- 임의로 채우면 특정 학생이 그 코드를 못 쓰게 만들 수 있다.
--
-- 클라이언트의 invite_codes 쓰기는 INSERT 뿐이다:
--     apps/teacher/src/app/m1.tsx:1183 · apps/teacher-mobile/src/inviteCodeScreen.tsx:69
-- used_by 를 채우는 것은 request_connection_by_invite(security definer)의 일이다.
revoke update on table invite_codes from authenticated;
revoke update on table invite_codes from anon;

-- ── ③ lesson_fees: 연결 없는 학생에게 청구할 수 없게 한다 ───────────────────
--
-- 실측 두 건: 교사가 fee 행의 student_id 를 **연결이 없는 학생**으로 바꿨고,
--            연결이 없는 학생에게 새 청구(999,999원)를 만들 수도 있었다.
--
-- 여기서는 컬럼 권한이 답이 아니다. 이유가 둘이다:
--   (a) 문제가 UPDATE 에만 있는 게 아니다 — INSERT 로도 임의 학생에게 청구가 생긴다.
--       컬럼 권한은 INSERT 를 막지 못한다.
--   (b) student_id 를 회수하면 정상 흐름이 깨진다. 모바일의 저장이 upsert 이고
--       onConflict 가 (teacher_id, student_id, period) 라 student_id 를 매번 실어 보낸다:
--           apps/teacher-mobile/src/lessonFeesScreen.tsx:111
--
-- 그래서 정책에 연결 요건을 넣는다. 형제 표(lessons·exam_records)가 이미 같은 모양이고,
-- 그 둘은 실측에서 미연결 학생 삽입이 42501 로 막혔다 — 같은 잣대를 맞추는 것이다.
--
-- ⚠️ 다만 형제 표처럼 `status = 'active'` 를 요구하지 **않는다.** 청구 기록은 연결이 끊긴
--    뒤에도 남아야 한다 — 미납 청구서를 연결 해제로 잃으면 안 된다. 그래서 "연결이 존재하기만
--    하면" 으로 둔다. 임의의 학생에게 청구를 만드는 것은 이것만으로 막힌다.
drop policy if exists fees_teacher_rw on lesson_fees;
create policy fees_teacher_rw on lesson_fees for all
  using (
    teacher_id = auth.uid()
    and exists (
      select 1 from connections c
       where c.teacher_id = auth.uid()
         and c.student_id = lesson_fees.student_id
    )
  )
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from connections c
       where c.teacher_id = auth.uid()
         and c.student_id = lesson_fees.student_id
    )
  );

comment on policy fees_teacher_rw on lesson_fees is
  '교사 본인 + 그 학생과 연결이 존재할 때만. active 를 요구하지 않는 이유: 연결이 끊긴 뒤에도 '
  '미납 청구서에 접근해야 한다. 20260820010000 참고.';
