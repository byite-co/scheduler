-- 앱 내 알림 생성 (푸시 아님).
--
-- [왜] notifications 테이블은 처음부터 있었지만 **INSERT 하는 프로덕션 코드가 0건**이었다.
--   두 앱의 알림 센터는 아무도 채우지 않는 테이블을 읽고 있었고, 과외쌤 앱의
--   "숙제를 내면 학생에게 알림이 가요" 문구는 사실이 아니었다.
--
-- [왜 트리거인가 — RPC/Edge Function 이 아니라]
--   1. 알림이 필요한 이벤트 7건 중 5건이 **클라이언트가 테이블에 직접 쓰는** 경로다
--      (숙제 출제·제출·확인/반려·연결 수락). RPC 로 바꾸면 두 앱의 호출부를 전부 고쳐야 하고,
--      한 곳이라도 빠뜨리면 그 경로만 조용히 알림이 없다.
--   2. 트리거는 **모든 쓰기 경로를 덮는다.** 앞으로 생길 앱(과외쌤 모바일)이 같은 테이블에
--      쓰기만 하면 별도 작업 없이 알림이 나간다.
--   3. RLS 때문에 클라이언트는 애초에 남의 알림을 만들 수 없다(notif_self 의 with check).
--      security definer 함수만이 상대방에게 알림을 남길 수 있다.
--
-- [실패해도 원래 작업을 막지 않는다]
--   AFTER 트리거에서 예외가 나면 **트랜잭션 전체가 롤백된다** — 알림 버그로 숙제 출제가
--   실패하는 것은 받아들일 수 없다. 그래서 각 트리거는 예외를 삼키고 warning 만 남긴다.
--   조용히 죽는 대신 Postgres 로그에 남으므로 나중에 추적할 수 있다.
--
-- [이번 범위가 아닌 것]
--   · 푸시 알림(앱 밖). push_tokens 는 여전히 아무도 쓰지 않는다. 별도 작업이다.
--   · AI 검사 완료 알림. 판정 노출이 AI_CHECK_RESULTS_ENABLED=false 로 막혀 있어,
--     지금 보내면 "볼 수 없는 결과"를 알리게 된다. 플래그를 열 때 함께 넣는다.

-- ── 공통 삽입 헬퍼 ───────────────────────────────────────────────────────────
-- security definer 로 RLS(notif_self)를 넘어 상대방에게 알림을 남긴다.
-- 수신자가 없거나(연결 없는 혼공 할 일 등) 자기 자신이면 아무것도 하지 않는다.
create or replace function emit_notification(
  p_user_id uuid,
  p_type notif_type,
  p_title text,
  p_body text default null,
  p_payload jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  -- 자기가 한 일을 자기에게 알리지 않는다. service_role 실행 시 auth.uid() 는 null 이라
  -- 이 조건은 서버 경로를 막지 않는다.
  if p_user_id = auth.uid() then
    return;
  end if;

  insert into notifications (user_id, type, title, body, payload)
  values (p_user_id, p_type, p_title, p_body, p_payload);
end;
$$;

comment on function emit_notification(uuid, notif_type, text, text, jsonb) is
  '앱 내 알림 1건 생성. 트리거 전용 — 클라이언트가 직접 부를 일이 없다.';

revoke all on function emit_notification(uuid, notif_type, text, text, jsonb) from public;
revoke all on function emit_notification(uuid, notif_type, text, text, jsonb) from anon;
revoke all on function emit_notification(uuid, notif_type, text, text, jsonb) from authenticated;

-- ── 1. 선생님이 숙제를 냈다 → 학생 ───────────────────────────────────────────
create or replace function notify_teacher_homework_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'teacher' then
    perform emit_notification(
      new.student_id,
      'homework',
      '새 숙제가 등록됐어요',
      new.title,
      jsonb_build_object('todoId', new.id)
    );
  end if;
  return null;
exception when others then
  -- 알림 실패로 숙제 출제를 되돌리지 않는다.
  raise warning 'notify_teacher_homework_assigned failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_teacher_homework_assigned_trigger on todos;
create trigger notify_teacher_homework_assigned_trigger
after insert on todos
for each row execute function notify_teacher_homework_assigned();

-- ── 2. 학생이 숙제를 제출했다 → 연결된 선생님 ────────────────────────────────
create or replace function notify_homework_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id uuid;
  v_title text;
begin
  -- 선생님 숙제만 알린다. 혼공 할 일은 connection_id 가 없어 수신자가 없다.
  select c.teacher_id, t.title
    into v_teacher_id, v_title
    from todos t
    join connections c on c.id = t.connection_id
   where t.id = new.todo_id
     and c.status = 'active';

  perform emit_notification(
    v_teacher_id,
    'homework',
    '학생이 숙제를 제출했어요',
    v_title,
    jsonb_build_object('todoId', new.todo_id, 'submissionId', new.id)
  );
  return null;
exception when others then
  raise warning 'notify_homework_submitted failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_homework_submitted_trigger on homework_submissions;
create trigger notify_homework_submitted_trigger
after insert on homework_submissions
for each row execute function notify_homework_submitted();

-- ── 3. 선생님이 확인/반려했다 → 학생 ─────────────────────────────────────────
create or replace function notify_homework_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  select t.title into v_title from todos t where t.id = new.todo_id;

  -- 반려(다시 제출 요청). resubmit_requested 로도 판정하는 이유: 두 필드가 같은 UPDATE 에서
  -- 함께 바뀌지만, 한쪽만 바뀌는 경로가 생겨도 알림은 나가야 한다.
  if (new.teacher_status = 'rejected' and old.teacher_status is distinct from 'rejected')
     or (new.resubmit_requested and not old.resubmit_requested) then
    perform emit_notification(
      new.student_id,
      'resubmit',
      '숙제를 다시 제출해 주세요',
      coalesce(nullif(new.teacher_comment, ''), v_title),
      jsonb_build_object('todoId', new.todo_id)
    );
  elsif new.teacher_status = 'confirmed' and old.teacher_status is distinct from 'confirmed' then
    perform emit_notification(
      new.student_id,
      'check_done',
      '숙제 확인이 끝났어요',
      coalesce(nullif(new.teacher_comment, ''), v_title),
      jsonb_build_object('todoId', new.todo_id)
    );
  end if;
  return null;
exception when others then
  raise warning 'notify_homework_reviewed failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_homework_reviewed_trigger on homework_submissions;
create trigger notify_homework_reviewed_trigger
after update on homework_submissions
for each row execute function notify_homework_reviewed();

-- ── 4. 연결 요청·수락·거절 → 상대방 ──────────────────────────────────────────
create or replace function notify_connection_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid := new.requested_by;
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    -- 요청은 어느 쪽에서도 시작될 수 있다. 요청자가 아닌 쪽에 알린다.
    perform emit_notification(
      case when v_requester = new.student_id then new.teacher_id else new.student_id end,
      'connection',
      '새 연동 요청이 왔어요',
      null,
      jsonb_build_object('connectionId', new.id)
    );
  elsif tg_op = 'UPDATE' and new.status = 'active' and old.status is distinct from 'active' then
    perform emit_notification(
      new.student_id,
      'connection',
      '선생님과 연동됐어요',
      null,
      jsonb_build_object('connectionId', new.id)
    );
  elsif tg_op = 'UPDATE' and new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform emit_notification(
      new.student_id,
      'connection',
      '연동 요청이 거절됐어요',
      null,
      jsonb_build_object('connectionId', new.id)
    );
  end if;
  return null;
exception when others then
  raise warning 'notify_connection_change failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_connection_change_trigger on connections;
create trigger notify_connection_change_trigger
after insert or update on connections
for each row execute function notify_connection_change();

-- ── 5. 리포트를 보냈다 → 학생 ────────────────────────────────────────────────
-- 이 알림이 /report(나의 리포트)로 가는 딥링크가 된다(getNotificationRoute 의 report → /report).
create or replace function notify_report_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    perform emit_notification(
      new.student_id,
      'report',
      '새 리포트가 도착했어요',
      null,
      jsonb_build_object('reportId', new.id)
    );
  end if;
  return null;
exception when others then
  raise warning 'notify_report_sent failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_report_sent_trigger on reports;
create trigger notify_report_sent_trigger
after update on reports
for each row execute function notify_report_sent();
