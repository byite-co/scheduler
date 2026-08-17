-- 약관 동의 증적 — 과외쌤 웹 가입에 동의 절차가 아예 없던 것을 채운다(출시 차단 항목).
--
-- [무엇이 문제였나] 학생 앱에는 동의 토글이 있는데 **과외쌤 웹 가입에는 동의 절차가 0건**이다
--   (A0 §A4). 게다가 학생 앱 쪽도 토글 상태를 온보딩 단계 사이에서만 들고 다니고
--   **어디에도 기록하지 않는다** — "언제 무엇에 동의했는가" 를 증명할 수 없다.
--   과외쌤은 학생의 개인정보를 다루는 쪽이라 더더욱 증적이 필요하다.
--
-- [이번 범위] 문안은 법률 검토 대기다. **증적 구조와 UI 골격까지만** 만든다.
--   문서 본문·URL 은 확정 후 붙인다. 버전은 'draft-0' 으로 기록해 두고, 정식 문서가 나오면
--   새 버전으로 다시 동의를 받는다(옛 행은 그대로 남는다 — 그게 증적이다).
--
-- ════════════════════════════════════════════════════════════════════════════
-- 설계 원칙: append-only
-- ════════════════════════════════════════════════════════════════════════════
--
-- 동의 기록은 **고쳐 쓰지 않는다.** UPDATE·DELETE 정책을 만들지 않는 이유:
--   · 동의는 "그 시점의 사실" 이다. 나중에 바꿀 수 있으면 증적이 아니다.
--   · 철회도 **새 행**으로 기록한다(action='withdrawn'). 기존 행을 지우면 "동의했던 사실"
--     자체가 사라져서, 그 사이 처리한 데이터의 근거를 설명할 수 없게 된다.
--   · 정책이 아예 없으면 RLS 기본 거부가 최종 방어선이다(ad_unlocks 와 같은 방식).
--
-- 삽입은 **본인 것만** 허용한다. 남의 동의를 만들 수 있으면 증적의 의미가 없다.
-- INSERT 정책을 두는 이유: 가입 직후 클라이언트가 직접 기록해야 하고(서버 함수를 거치면
-- 가입 트랜잭션과 어긋날 수 있다), 위조 위험은 "본인 행만" + append-only 로 충분히 좁다.

create table if not exists consent_records (
  id           uuid primary key default gen_random_uuid(),

  -- 동의를 한 계정. 탈퇴하면 함께 사라진다 — 개인정보 보관 최소화가 우선이다.
  -- (탈퇴 후에도 증적이 필요하다는 요구가 생기면 별도 익명화 보관을 설계해야 한다.)
  user_id      uuid not null references profiles(id) on delete cascade,

  -- ⚠️ **동의 주체가 본인이 아닐 수 있다.** 만 14세 미만은 보호자가 동의한다.
  --    보호자 동의 흐름은 이번 범위가 아니지만, 나중에 컬럼을 새로 붙이면 기존 행의
  --    주체가 불명확해진다 → 지금부터 명시한다. 기본값은 '본인'.
  subject      text not null default 'self',

  document     text not null,   -- 어떤 문서에 동의했는가
  version      text not null,   -- 그 문서의 버전. 문안이 바뀌면 새 버전으로 다시 받는다
  action       text not null default 'accepted',
  -- 어떤 화면·경로로 받았는가. 분쟁 시 "어디서 눌렀나" 를 설명하는 데 쓴다.
  method       text not null default 'signup_checkbox',
  recorded_at  timestamptz not null default now(),

  constraint consent_records_subject_check
    check (subject in ('self', 'guardian')),
  constraint consent_records_document_check
    check (document in ('terms_of_service', 'privacy_policy', 'marketing_optional')),
  constraint consent_records_action_check
    check (action in ('accepted', 'withdrawn')),
  constraint consent_records_version_not_blank
    check (btrim(version) <> ''),
  constraint consent_records_method_not_blank
    check (btrim(method) <> '')
);

-- "이 사용자가 이 문서의 최신 상태가 무엇인가" 를 뽑는 것이 주 질의다.
create index if not exists consent_records_user_doc_idx
  on consent_records (user_id, document, recorded_at desc);

comment on table consent_records is
  '약관 동의 증적. append-only — UPDATE·DELETE 정책 없음. 철회는 action=withdrawn 새 행으로 기록한다.';
comment on column consent_records.subject is
  '동의 주체. self=본인 / guardian=보호자(만14세 미만). 보호자 흐름은 미구현이지만 컬럼은 열어 둔다.';
comment on column consent_records.version is
  '동의한 문서의 버전. 정식 문안 확정 전에는 draft-0. 문안이 바뀌면 새 버전으로 다시 받는다.';

alter table consent_records enable row level security;

-- 본인 행만 읽는다. 남의 동의 이력은 보이지 않는다.
drop policy if exists consent_records_select_self on consent_records;
create policy consent_records_select_self on consent_records
  for select to authenticated
  using (user_id = auth.uid());

-- 본인 행만 남긴다. 주체가 self 인 경우로 한정한다 —
-- guardian 동의는 보호자 확인 절차가 필요하므로 클라이언트가 임의로 만들 수 없어야 한다.
drop policy if exists consent_records_insert_self on consent_records;
create policy consent_records_insert_self on consent_records
  for insert to authenticated
  with check (user_id = auth.uid() and subject = 'self');

-- UPDATE / DELETE 정책은 **만들지 않는다.** 동의는 고쳐 쓰지 않는다.
-- 테이블 권한도 좁혀 둔다(정책이 추가되는 순간 열리는 것을 막는 이중 방어).
revoke all on table consent_records from anon;
revoke update, delete, truncate, references on table consent_records from authenticated;

/**
 * 이 사용자의 문서별 **최신** 동의 상태. 화면이 "다시 동의를 받아야 하나" 를 판단한다.
 * 이력 전체가 아니라 문서별 마지막 행만 준다 — 화면은 최신 상태만 필요하다.
 */
create or replace function my_consent_status()
returns table (document text, version text, action text, subject text, recorded_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (c.document)
         c.document, c.version, c.action, c.subject, c.recorded_at
  from consent_records c
  where c.user_id = auth.uid()
  order by c.document, c.recorded_at desc
$$;

comment on function my_consent_status() is
  '호출자의 문서별 최신 동의 상태. security invoker — RLS(본인 행)가 그대로 적용된다.';

revoke all on function my_consent_status() from public;
revoke all on function my_consent_status() from anon;
grant execute on function my_consent_status() to authenticated;
