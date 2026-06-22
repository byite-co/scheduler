-- M6: 수익화(앱 구독료 — 수업료와 별개).
-- 월 청구 = active 연결 수 × 단가. 단가는 단일 SQL 출처(price_per_student_krw) + TS 상수(PRICE_PER_STUDENT_KRW)로
-- 이중 정의, 테스트로 교차검증한다(하드코딩 산재 금지).
--
-- ⚠️ 실제 Stripe/RevenueCat 웹훅은 키 준비 후 Edge Function(billing-stripe / iap-webhook)으로 구현한다.
--    아래 mock_* RPC는 그 웹훅을 대신하는 DEV 전용 모의이며, 실연동 시 제거/치환한다.

create or replace function price_per_student_krw()
returns integer
language sql
immutable
as $$ select 2900 $$;

-- 앱 구독료 인보이스 생성: active 연결 수 × 단가. (과외쌤 본인만)
create or replace function generate_teacher_invoice(p_period text)
returns billing_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
  result_row billing_invoices%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select count(*)::integer into active_count
    from connections
    where teacher_id = auth.uid() and status = 'active';

  insert into billing_invoices (teacher_id, period, student_count, amount, status)
  values (auth.uid(), p_period, active_count, active_count * price_per_student_krw(), 'open')
  on conflict (teacher_id, period) do update
    set student_count = excluded.student_count,
        amount = excluded.amount
  returning * into result_row;

  return result_row;
end;
$$;

revoke all on function generate_teacher_invoice(text) from public;
grant execute on function generate_teacher_invoice(text) to authenticated;

-- DEV MOCK: Stripe 웹훅 대체 — 과외쌤 본인 구독 상태 전이(active/past_due/canceled/paused).
create or replace function mock_set_teacher_subscription(p_status sub_status)
returns teacher_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row teacher_subscriptions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  insert into teacher_subscriptions (teacher_id, status, provider, current_period_end, updated_at)
  values (auth.uid(), p_status, 'stripe', now() + interval '30 days', now())
  on conflict (teacher_id) do update
    set status = excluded.status,
        updated_at = now()
  returning * into result_row;

  return result_row;
end;
$$;

revoke all on function mock_set_teacher_subscription(sub_status) from public;
grant execute on function mock_set_teacher_subscription(sub_status) to authenticated;

-- DEV MOCK: IAP 웹훅 대체 — 학생 본인 프리미엄 상태 전이.
create or replace function mock_set_student_subscription(p_status sub_status, p_expires_at timestamptz default null)
returns student_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row student_subscriptions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  insert into student_subscriptions (student_id, status, provider, expires_at, updated_at)
  values (auth.uid(), p_status, 'iap', coalesce(p_expires_at, now() + interval '30 days'), now())
  on conflict (student_id) do update
    set status = excluded.status,
        expires_at = excluded.expires_at,
        updated_at = now()
  returning * into result_row;

  return result_row;
end;
$$;

revoke all on function mock_set_student_subscription(sub_status, timestamptz) from public;
grant execute on function mock_set_student_subscription(sub_status, timestamptz) to authenticated;
