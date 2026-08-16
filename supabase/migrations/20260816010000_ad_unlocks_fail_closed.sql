-- ad_unlocks 실패-폐쇄 — 광고 보상 언락 발급 경로를 전면 차단한다.
--
-- [문제] A0 감사에서 확인됐다. 정책이 하나뿐이고 그게 for all 이라 학생이 **광고를 보지 않고도**
--   자기 언락 행을 직접 INSERT 할 수 있었다. 프리미엄 게이트(나의 리포트·AI 추천)가
--   이 표 한 줄로 열리므로, 사실상 유료 기능이 무료였다.
--
-- [before — 2026-08-16 실측, pg_policies]
--   policyname : unlock_self
--   cmd        : ALL
--   roles      : {public}
--   qual       : (student_id = auth.uid())
--   with_check : (student_id = auth.uid())
--   → 본인 행 한정이긴 하나, "본인이 스스로 발급"이 곧 우회다. 소유 검증은 광고 시청을
--     증명하지 못한다. 테이블 권한도 anon·authenticated 모두 SELECT/INSERT/UPDATE/DELETE 전부 있었다.
--
-- [왜 "서버 발급만 허용"이 아니라 발급 자체를 막는가]
--   광고 시청 완료를 검증하는 서버 경로가 **존재하지 않는다**. 클라이언트는
--   apps/student/src/m5Screens.tsx:88 에서 `NOTE(mock)` 로 시청을 가정하고 행을 넣을 뿐이다.
--   검증자가 없는데 발급구만 좁히면 "누가 넣었나"만 바뀌고 "정말 봤나"는 여전히 아무도 모른다.
--   광고 SDK 연동과 서버 검증(리워드 콜백 서명 확인)이 생기기 전까지는 발급을 0 으로 둔다.
--
-- [after — 목표 상태]
--   anon          : 전면 금지(테이블 권한 자체를 회수)
--   authenticated : 본인 행 SELECT 만. INSERT/UPDATE/DELETE 는 **정책이 없다**
--                   → RLS 가 기본 거부하므로 어떤 요청도 통과하지 못한다.
--   service_role  : 변경 없음(RLS 우회). 나중에 서버 발급 경로가 생기면 여기로 들어온다.
--
-- [기존 행] 2026-08-16 기준 **0행**(select count(*) from ad_unlocks). 지우지 않는다 —
--   지금은 지울 것도 없지만, 나중에 행이 있는 상태로 이 마이그레이션을 다시 읽을 사람을 위해
--   "발급만 막고 기존 권리는 건드리지 않는다"는 원칙을 명시해 둔다.
--
-- ⚠️ 클라이언트에서 광고 언락 UI 는 AD_UNLOCK_ENABLED 플래그로 함께 숨긴다
--    (packages/shared/src/featureFlags.ts). 서버만 막고 버튼을 남기면 눌러도 실패하는
--    버튼이 되어 고장으로 보인다.

-- for all 정책 제거. 이게 유일한 정책이었다.
drop policy if exists unlock_self on ad_unlocks;

-- 남은 언락(현재 0행)을 화면이 읽을 수 있게 SELECT 만 남긴다.
-- 이 조회가 막히면 useGatedFeature 가 매번 오류를 내고, 게이트가 "오류로 잠김"이 되어
-- 왜 안 열리는지 알 수 없게 된다.
create policy ad_unlocks_select_self on ad_unlocks
  for select to authenticated
  using (student_id = auth.uid());

-- INSERT / UPDATE / DELETE 정책은 **일부러 만들지 않는다.**
-- RLS 가 켜진 표에서 해당 명령의 정책이 없으면 모든 행이 거부된다(기본 거부).
-- 정책을 만들어 두고 조건으로 막는 것보다, 아예 없는 편이 실수로 완화될 여지가 적다.

-- 정책 아래에 테이블 권한도 회수한다(이중 방어).
-- 정책만 고치면 나중에 누군가 정책을 추가했을 때 곧바로 열린다.
revoke all on table ad_unlocks from anon;
revoke insert, update, delete, truncate, references on table ad_unlocks from authenticated;

comment on table ad_unlocks is
  '광고 보상 언락. 2026-08-16 발급 전면 중지 — 광고 시청을 검증하는 서버 경로가 없어 자가 발급이 가능했다. 조회만 열려 있다.';
