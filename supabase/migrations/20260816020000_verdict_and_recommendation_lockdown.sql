-- AI 판정·추천 쓰기 경로 긴급 잠금 (A1 의 [지금 뚫림] 2건).
--
-- ════════════════════════════════════════════════════════════════════════════
-- [1] apply_homework_ai_verdict — anon EXECUTE 회수 + 함수 내부 호출자 검증
-- ════════════════════════════════════════════════════════════════════════════
--
-- [before — 2026-08-16 실측]
--   information_schema.routine_privileges → grantee = anon, postgres, service_role
--   함수 본문에 권한 검사 **0줄**:
--     update homework_submissions set ai_verdict = p_verdict, ... where id = p_submission_id
--   A1 §2-7 실측: anon key 로 호출 시 HTTP 400 `P0001 homework_submission_not_found`.
--   400 은 권한 거부가 아니라 **본문이 실행된 결과**다 — id 만 맞으면 아무 제출의 판정을
--   덮어쓸 수 있었다. 학생은 자기 submission id 를 알고 있다.
--
-- [왜 anon 만 남아 있었나] 원본(20260624000000:41-43)은 이렇게 회수했다:
--     revoke all ... from public;
--     revoke all ... from authenticated;
--     grant execute ... to service_role;
--   `revoke ... from public` 은 Supabase 기본 권한(ALTER DEFAULT PRIVILEGES)이 **롤별로**
--   부여한 grant 를 지우지 못한다. authenticated 는 명시적으로 회수해서 빠졌고,
--   anon 은 목록에 없어서 그대로 남았다.
--   ⚠️ 같은 실수가 20260806000000(mock 구독 RPC)에서 이미 한 번 있었다. 그때의 교훈이
--      "anon 을 명시적으로 회수해라" 였는데, 이 함수는 그 점검에서 빠져 있었다.
--
-- [호출자 조사 — 클라이언트 호출 0건]
--   · Edge Function(ai-homework-check)은 이 함수를 **부르지 않는다**.
--     실제 기록 경로는 record_homework_check_observation(service_role 전용)이다.
--     index.ts:20 주석과 m4.schema.test.ts:193 의 단정이 이를 고정하고 있다.
--   · 학생 앱·과외쌤 웹·teacher-mobile 어디에도 호출 0건.
--   · 유일한 호출부는 m4.homework.rls.integration.test.ts:161 이며 service_role 로 부른다.
--   → 회수해도 정상 경로는 영향이 없다.
--
-- [이 함수는 DEPRECATED 다] 20260806040000 이 그렇게 표시했다. attempt 없이 ai_* 만
--   덮어써서 이력이 남지 않는다. 지우지 않는 이유는 전환 기간이기 때문이고, 남아 있는 한
--   "attempt 없이 판정을 쓸 수 있는 경로"라 권한이 더더욱 좁아야 한다.

revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from public;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from anon;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from authenticated;
grant execute on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) to service_role;

-- 이중 방어: 권한을 회수해도 누군가 GRANT 를 되돌리는 순간 다시 열린다.
-- 함수 자신이 호출 주체를 확인하면 그 사고를 한 겹 더 막는다(ad_unlocks 와 같은 논리).
--
-- 판정 규칙:
--   · anon 키        → auth.role() = 'anon'          → 거부
--   · 사용자 토큰    → auth.role() = 'authenticated' → 거부
--   · service_role 키 → auth.role() = 'service_role' → 통과
--   · JWT 자체가 없음(psql·Management API·마이그레이션) → auth.role() = null → 통과
--     coalesce 로 null 을 통과시키는 이유: 운영 점검·데이터 보정을 막으면 안 된다.
--     이 경로는 이미 DB 직접 접근 권한이 있는 사람만 쓸 수 있어 새로 여는 문이 아니다.
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
  -- 호출 주체 검증. 권한 회수와 별개로 함수 스스로 막는다.
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

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

comment on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) is
  'DEPRECATED(20260806040000): attempt 기록 없이 ai_* 만 덮어쓴다. complete_homework_check_attempt 를 쓸 것. 20260816020000 에서 anon 회수 + 호출 주체 검증 추가.';

-- create or replace 는 권한을 유지하지만, 순서가 바뀌어도 결과가 같도록 한 번 더 고정한다.
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from public;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from anon;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from authenticated;
grant execute on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- [2] ai_recommendations — 클라이언트 쓰기 회수
-- ════════════════════════════════════════════════════════════════════════════
--
-- [before — 2026-08-16 실측]
--   policyname : airec_student_rw / cmd : ALL / roles : {public}
--   qual/with_check : (student_id = auth.uid())
--   테이블 권한 : anon·authenticated 모두 SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES
--   A1 §2-6c 실측: 학생 토큰으로 INSERT → **HTTP 201 Created**.
--
-- [정상 쓰기 경로가 무엇인가 — 서버에 없다]
--   이 표에 쓰는 코드는 apps/student/src/m5Screens.tsx:163 의 upsert 하나뿐이다.
--   그마저도 추천값 자체가 서버 산출물이 아니라 **클라이언트 순수 함수 스텁**
--   (getStubStudyRecommendation)의 결과다. AI 호출도, 서버 검증도 없다.
--   읽는 코드는 레포 전체에 **0건**이다 — 쓰기만 하고 아무도 읽지 않는 표다.
--
-- [그래서 무엇을 막는가] 유료 기능(AI 공부량 추천)의 산출물 저장소를 사용자가 직접
--   채울 수 있다는 것 자체가 구멍이다. 나중에 서버가 이 표를 신뢰해 읽기 시작하면
--   (리포트·추천 이력 등) 사용자가 심어 둔 값을 그대로 믿게 된다.
--   추천 생성을 서버로 옮길지는 A2 에서 정한다. 그때까지 **쓰기를 0 으로 둔다.**

drop policy if exists airec_student_rw on ai_recommendations;

-- 본인 행 조회만 남긴다. 지금 읽는 코드는 없지만, 나중에 서버가 채운 추천을 학생이
-- 봐야 하므로 조회는 열어 둔다(ad_unlocks 와 같은 판단).
create policy ai_recommendations_select_self on ai_recommendations
  for select to authenticated
  using (student_id = auth.uid());

-- INSERT / UPDATE / DELETE 정책은 **만들지 않는다.** RLS 기본 거부가 최종 방어선이다.
revoke all on table ai_recommendations from anon;
revoke insert, update, delete, truncate, references on table ai_recommendations from authenticated;

comment on table ai_recommendations is
  'AI 공부량 추천 결과. 2026-08-16 클라이언트 쓰기 차단 — 유료 산출물을 사용자가 직접 채울 수 있었다. 서버 생성 경로는 A2 에서 결정.';
