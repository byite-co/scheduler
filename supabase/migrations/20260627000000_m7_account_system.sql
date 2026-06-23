-- M7: 계정(회원 탈퇴) + 시스템 상태(강제 업데이트/점검).

-- 1) 회원 탈퇴: 본인 auth.users 행 삭제 → profiles(on delete cascade) → 모든 앱 데이터 cascade.
--    학생/과외쌤 본인만 본인 계정을 지운다(영구·복구 불가). 연결·구독도 함께 정리된다.
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function delete_my_account() from public;
grant execute on function delete_my_account() to authenticated;

-- 2) 시스템 상태 설정(단일 행). 강제 업데이트 빌드/점검 플래그.
--    공개 읽기(anon 포함) — 앱 부팅 시 게이트 판단. 쓰기는 서비스롤/대시보드로만.
create table if not exists app_config (
  id                  smallint primary key default 1,
  latest_build        integer not null default 1,
  min_supported_build integer not null default 1,   -- 이 값 미만이면 강제 업데이트
  maintenance         boolean not null default false,
  maintenance_message text,
  updated_at          timestamptz not null default now(),
  constraint app_config_singleton check (id = 1)
);
alter table app_config enable row level security;

drop policy if exists app_config_read on app_config;
create policy app_config_read on app_config for select to anon, authenticated using (true);

insert into app_config (id, latest_build, min_supported_build, maintenance)
values (1, 1, 1, false)
on conflict (id) do nothing;
