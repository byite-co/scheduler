-- R3 작업 1 — 동의 기록과 온보딩 완료를 한 트랜잭션으로 묶는다.
--
-- [무엇이 문제였나]
--   세 화면 모두 **onboarded=true 를 먼저 저장하고 동의를 나중에** 기록했다.
--   그래서 동의 기록이 실패하면 "온보딩은 끝났는데 동의 증적이 없는 계정" 이 남는다.
--
--     apps/student/src/m1Screens.tsx:401  profiles.upsert({... onboarded: true}) → 그 뒤 consent insert
--       실패해도 되돌리지 않는다(주석이 그렇게 적혀 있다). 메시지에만 남기고 /today 로 넘어간다.
--     apps/teacher/src/app/m1.tsx:603     같은 순서. 게다가 consent insert 의 error 를 **읽지도 않는다**.
--     apps/teacher/src/app/m1.tsx:1109    가입 직후 consent insert. 여기도 error 를 읽지 않는다.
--
--   동의 증적은 "그 시점에 동의했다" 를 증명하는 유일한 근거다(A4). 증적 없이 서비스를 쓰는
--   계정이 생기는 경로를 남겨 두면, 나중에 그 계정이 처리한 데이터의 근거를 설명할 수 없다.
--
-- [해결 — 순서를 뒤집고 하나로 묶는다]
--   1) 클라이언트는 프로필 필드만 저장한다. **onboarded 는 건드리지 않는다**(기본값 false).
--   2) 이 RPC 가 "동의 기록 + onboarded=true" 를 한 트랜잭션에서 한다.
--      필수 문서가 빠지면 **아무것도 쓰지 않고 거부**한다 → onboarded 는 false 로 남는다.
--   그래서 동의 없이 온보딩이 완료되는 상태가 존재할 수 없다.
--
-- [왜 프로필 필드를 이 RPC 가 받지 않는가]
--   학생/과외쌤의 프로필 필드가 서로 다르고(생년월일·학년 vs 소개·과목), 앞으로도 달라진다.
--   그걸 SQL 시그니처에 복제하면 화면이 필드를 하나 추가할 때마다 마이그레이션이 필요해진다.
--   불변식은 "동의 없이 onboarded=true 가 되지 않는다" 하나뿐이므로, **그 하나만** 서버가 쥔다.
--
-- [A5 §3 의 서버 강제 C+A 중 C 에 해당한다]
--   A(트리거로 전역 강제)는 아직 하지 않는다 — apps/teacher-mobile 이 여전히 onboarded 를 직접
--   저장하고(authScreens.tsx:256, profileSettingsScreen.tsx:46) 이번 작업은 그 경로를 건드릴 수
--   없다. 전역 트리거를 지금 걸면 teacher-mobile 가입이 막힌다. mobile 이 이 RPC 로 옮겨온 뒤가
--   A 의 시점이다. 그때까지 이 RPC 는 "이 경로에서는 불변식이 성립한다" 를 보장한다.

create or replace function finish_onboarding_with_consent(
  p_documents text[],
  p_version text,
  p_method text default 'onboarding'
)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
  profile_row profiles%rowtype;
  required text[] := array['terms_of_service', 'privacy_policy'];
  missing text[];
begin
  me := auth.uid();
  if me is null then
    raise exception 'authentication_required';
  end if;

  if p_version is null or btrim(p_version) = '' then
    raise exception 'consent_version_required';
  end if;

  -- 프로필이 먼저 있어야 한다. 클라이언트가 프로필 필드를 저장한 **뒤** 부르는 순서다.
  select * into profile_row from profiles where id = me for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  -- 필수 문서 검사.
  --
  -- 이번에 넘어온 문서 **또는 이미 이 버전으로 기록된 문서**를 합쳐서 판정한다.
  -- 두 경로가 다 있기 때문이다:
  --   · 가입 때 세션이 있었으면 동의가 그 시점에 이미 기록된다 → 여기로는 빈 목록이 온다.
  --   · 이메일 인증 경로는 가입 때 기록할 수 없어 화면이 체크 상태를 들고 왔다 → 목록이 온다.
  -- 그래서 "이미 기록돼 있으면 통과" 를 **서버가** 판정한다. 화면이 "아마 했을 것" 으로
  -- 추정해 목록을 채워 보내면 동의하지 않은 사용자의 증적을 만들어 낼 수 있다 — 그건 위조다.
  -- 둘 다 없으면 거부하고 아무것도 쓰지 않는다 → onboarded 는 false 로 남는다.
  -- ⚠️ 컬럼 이름을 명시적으로 준다: `unnest(required) r` 로 두면 테이블 별칭과 컬럼 이름이
  --    둘 다 r 이 되고, 상관 서브쿼리 안의 맨 r 이 컬럼이 아니라 **행 전체(composite)** 로
  --    해석될 수 있다. 그러면 `c.document = r` 이 조용히 never-match 가 된다
  --    (오류가 아니라 잘못된 결과다 — 실행 테스트가 이걸 잡았다).
  select array_agg(req.doc) into missing
    from unnest(required) as req(doc)
   where not (req.doc = any (coalesce(p_documents, array[]::text[])))
     and not exists (
       select 1 from consent_records c
        where c.user_id = me
          and c.document = req.doc
          and c.version = p_version
          and c.action = 'accepted'
     );

  if missing is not null and array_length(missing, 1) > 0 then
    raise exception 'consent_required_missing: %', array_to_string(missing, ',');
  end if;

  -- 동의 기록. append-only 표라 같은 (문서, 버전) 이 이미 accepted 면 다시 넣지 않는다
  -- — 재시도·중복 호출로 이력이 지저분해지는 것을 막는다(멱등).
  insert into consent_records (user_id, document, version, action, method, subject)
  select distinct me, d.doc, p_version, 'accepted', coalesce(p_method, 'onboarding'), 'self'
    from unnest(coalesce(p_documents, array[]::text[])) as d(doc)
   where not exists (
     select 1 from consent_records c
      where c.user_id = me
        and c.document = d.doc
        and c.version = p_version
        and c.action = 'accepted'
   );

  -- 여기까지 왔으면 동의가 기록됐다. 이제서야 온보딩을 완료로 표시한다.
  update profiles
     set onboarded = true
   where id = me
  returning * into profile_row;

  return profile_row;
end;
$$;

revoke all on function finish_onboarding_with_consent(text[], text, text) from public;
revoke all on function finish_onboarding_with_consent(text[], text, text) from anon;
grant execute on function finish_onboarding_with_consent(text[], text, text) to authenticated;

comment on function finish_onboarding_with_consent(text[], text, text) is
  '동의 기록 + onboarded=true 를 한 트랜잭션으로. 필수 문서(이용약관·개인정보)가 없으면 아무것도 '
  '쓰지 않고 거부한다 → 동의 없이 온보딩이 완료되는 상태가 존재할 수 없다. 멱등. 20260821000000 참고.';
