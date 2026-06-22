-- M4: AI 완료검사 (flagship).
-- AI 판정 결과(ai_verdict/ai_confidence/ai_reason)는 "서버 권위적"이다.
--  - 학생/과외쌤(인증 사용자, auth.uid() not null)은 ai_* 컬럼을 직접 쓰지 못한다.
--  - ai_* 는 오직 서비스롤(또는 정의자 RPC, auth.uid() is null)로만 기록된다 → Edge Function ai-homework-check.
--  - teacher_* 컬럼은 학생이 바꾸지 못한다(과외쌤 확인/반려 전용).
-- 채점이 아니라 "다 했는지" 확인이며, RLS는 약화하지 않고 무결성만 강화한다.

-- 1) AI 판정 기록 RPC (서비스롤 전용) ------------------------------------------
create or replace function apply_homework_ai_verdict(
  p_submission_id uuid,
  p_verdict submission_verdict,
  p_confidence numeric,
  p_reason text
)
returns homework_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row homework_submissions%rowtype;
begin
  update homework_submissions
    set ai_verdict = p_verdict,
        ai_confidence = case
          when p_confidence is null then null
          else greatest(0, least(1, p_confidence))
        end,
        ai_reason = p_reason
    where id = p_submission_id
    returning * into result_row;

  if not found then
    raise exception 'homework_submission_not_found';
  end if;

  return result_row;
end;
$$;

revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from public;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from authenticated;
grant execute on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) to service_role;

-- 2) 무결성 트리거: ai_* 는 서버만, teacher_* 는 학생이 못 바꾼다 --------------
create or replace function guard_homework_submission_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- AI 판정 필드는 서버 권위적: 인증 사용자(auth.uid() not null)는 설정/변경 불가.
  if auth.uid() is not null then
    if tg_op = 'INSERT'
      and (new.ai_verdict is not null
        or new.ai_confidence is not null
        or new.ai_reason is not null) then
      raise exception 'ai_fields_are_server_set';
    end if;

    if tg_op = 'UPDATE'
      and (new.ai_verdict is distinct from old.ai_verdict
        or new.ai_confidence is distinct from old.ai_confidence
        or new.ai_reason is distinct from old.ai_reason) then
      raise exception 'ai_fields_are_server_set';
    end if;
  end if;

  -- teacher_* 는 과외쌤 전용: 학생 본인은 확인/반려/재제출 요청 필드를 못 바꾼다.
  if tg_op = 'UPDATE' and auth.uid() = new.student_id then
    if new.teacher_status is distinct from old.teacher_status
      or new.teacher_comment is distinct from old.teacher_comment
      or new.resubmit_requested is distinct from old.resubmit_requested then
      raise exception 'teacher_fields_not_student_editable';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_homework_submission_fields_trigger on homework_submissions;
create trigger guard_homework_submission_fields_trigger
  before insert or update on homework_submissions
  for each row execute function guard_homework_submission_fields();

-- 3) 검사 큐/결과 조회 인덱스 --------------------------------------------------
create index if not exists homework_submissions_student_submitted_idx
  on homework_submissions (student_id, submitted_at desc);
create index if not exists homework_submissions_todo_submitted_idx
  on homework_submissions (todo_id, submitted_at desc);
