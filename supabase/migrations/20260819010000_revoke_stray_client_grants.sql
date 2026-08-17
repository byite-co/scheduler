-- 지시 밖 결함 (A5 에서 발견) — 정책이 0개인 표에 클라이언트 쓰기 권한이 남아 있었다.
--
-- [무엇이 문제였나]
--   아래 세 표는 RLS 가 켜져 있고 정책이 **하나도 없다**(= 클라이언트 전면 거부가 의도다).
--   그런데 ALTER DEFAULT PRIVILEGES 로 붙은 테이블 권한이 anon·authenticated 에 그대로 있었다:
--     report_views · storage_purge_log · storage_purge_queue
--       → anon/authenticated 각각 INSERT, UPDATE, DELETE, TRUNCATE
--
--   지금은 RLS 가 막아 준다(정책 0개 = 통과할 행이 없다). 즉 **현재 뚫려 있지는 않다.**
--   문제는 안전이 한 겹뿐이라는 것이다. 누군가 나중에 이 표에 조회용 정책 하나를
--   `for all` 로 잘못 붙이면 그 순간 쓰기까지 열린다 — A1 의 ad_unlocks 가 정확히 그랬다.
--
-- [왜 revoke ... from public 으로는 안 되는가]
--   ALTER DEFAULT PRIVILEGES 가 부여한 것은 public 이 아니라 **롤 각각**에 대한 권한이다.
--   그래서 롤 이름을 명시해 회수해야 한다. (A1 에서 같은 함정을 확인했다.)
--
-- service_role·postgres 권한은 건드리지 않는다 — 큐 처리기(account-delete sweep)와
-- 리포트 열람 기록이 그 권한으로 돈다.

revoke insert, update, delete, truncate on table report_views from anon, authenticated;
revoke insert, update, delete, truncate on table storage_purge_log from anon, authenticated;
revoke insert, update, delete, truncate on table storage_purge_queue from anon, authenticated;

-- SELECT 은 남겨 둔다. 정책이 0개라 어차피 0행이고, 회수하면 오류 코드가 42501 로 바뀌어
-- "표가 있다/없다" 를 구분해 알려 주는 쪽이 된다. 현재의 200 `[]` 가 더 조용하다.
