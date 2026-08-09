-- 회원 탈퇴를 실제로 되게 만든다 — profiles 를 참조하면서 ON DELETE 절이 없는 FK 2개.
--
-- [증상] 과외쌤이 숙제를 한 번이라도 내면 delete_my_account() 가 23503 으로 실패한다.
--   update or delete on table "profiles" violates foreign key constraint
--   "todos_created_by_fkey" on table "todos"
--   (2026-08-09 실연동으로 재현 확인. 학생 탈퇴는 정상 — 학생의 todos 는
--    todos.student_id 의 CASCADE 로 함께 지워지면서 참조가 풀린다.)
--
-- [왜 중요한가] 회원 탈퇴 도달 불가는 AGENTS.md 절대 규칙 위반이자 심사 리젝 사유다.
--   화면까지 갈 수 있게 만들어도 RPC 가 실패하면 고쳐진 게 아니다.
--   이 FK 는 이미 알려져 있었다 — rlsTestCleanup.ts 가 이것 때문에 "지워지는 것부터
--   지우고 재시도" 하는 정리기를 두고 있고, 과거에 테스트 계정 55건이 원격에 쌓였다.
--   그런데 **정리 우회는 테스트에만 있었고 프로덕션 탈퇴 경로에는 없었다.**
--
-- [왜 CASCADE 가 아니라 SET NULL 인가]
--   CASCADE 로 두면 과외쌤 한 명이 탈퇴할 때 **학생의 숙제 기록이 통째로 사라진다.**
--   한 사용자의 탈퇴가 다른 사용자의 데이터를 지우면 안 된다.
--   이미 같은 판단이 적용된 선례가 있다 — todos.connection_id 는 연결이 사라져도
--   `on delete set null` 로 할 일을 남긴다. 같은 원칙을 작성자에도 적용한다.
--
--   created_by / requested_by 는 제품 코드에서 **쓰기만 하고 읽지 않는다**(감사용 흔적).
--   따라서 NULL 이 되어도 화면·로직에 영향이 없다.

-- ── todos.created_by ────────────────────────────────────────────────────────
-- NOT NULL 을 풀어야 SET NULL 을 걸 수 있다. "누가 만들었는지 모름"이 "탈퇴 불가"보다 낫다.
alter table todos alter column created_by drop not null;
alter table todos drop constraint todos_created_by_fkey;
alter table todos
  add constraint todos_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

comment on column todos.created_by is
  '만든 사람(감사용). 그 사람이 탈퇴하면 NULL — 할 일 자체는 학생 것이므로 남긴다.';

-- ── connections.requested_by ────────────────────────────────────────────────
-- 이미 nullable 이므로 절만 바꾼다.
alter table connections drop constraint connections_requested_by_fkey;
alter table connections
  add constraint connections_requested_by_fkey
  foreign key (requested_by) references profiles(id) on delete set null;

comment on column connections.requested_by is
  '연동을 요청한 쪽(감사용). 탈퇴하면 NULL — 연결 이력은 남긴다.';
