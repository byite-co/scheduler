-- 가격 인상 (2026-08-10).
--
--   학생 프리미엄            2,900원/월  →  8,900원/월   (TS 상수만 — IAP 상품가)
--   과외쌤 앱 구독(학생 1인당) 2,900원/월  →  4,900원/월   (이 함수 + TS 상수)
--
-- 시장 조사(유사 서비스 콴다 프리미엄 월 18,500원)와 원가 분석에 따른 결정이다.
-- ⚠️ 수업료(학생 → 과외쌤)는 우리가 관여하지 않는다. 변경 없음.
--
-- [왜 DB 에도 값이 있는가] 월 청구액은 서버가 계산한다
-- (open_teacher_invoice: active_count * price_per_student_krw()).
-- 클라이언트 상수만 바꾸면 **화면에는 4,900원이 보이는데 청구는 2,900원**이 된다.
-- packages/shared/src/m6.schema.test.ts 가 두 값을 대조하므로 한쪽만 바꾸면 CI 가 잡는다.
--
-- [이미 발행된 청구서는 건드리지 않는다] billing_invoices.amount 는 발행 시점에 확정된
-- 금액이다. 소급 변경하면 과거 청구 이력이 사실과 달라진다. 다음 청구부터 새 단가가 적용된다.

create or replace function price_per_student_krw() returns integer
  language sql immutable as $$ select 4900 $$;

comment on function price_per_student_krw() is
  '과외쌤 앱 구독 단가(active 연결 학생 1인당, 원). 2026-08-10 인상 2900 → 4900. TS 의 PRICE_PER_STUDENT_KRW 와 같아야 한다.';
