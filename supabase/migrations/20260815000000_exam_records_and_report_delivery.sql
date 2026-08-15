-- 학부모 리포트 1단계 — 시험 기록 + 발송 상태.
--
-- [시험 기록이 왜 별도 테이블인가]
--   리포트 data(jsonb) 안에 넣으면 **주마다 값이 복사**되고, 등급 추이 그래프를 그리려면
--   지난 리포트들을 뒤져야 한다. 시험은 리포트보다 오래 사는 사실이므로 따로 쌓는다.
--   덕분에 "리포트를 안 만든 주에 본 시험"도 다음 리포트의 추이에 그대로 들어간다.
--
-- [가벼운 입력] 필수는 **과목 · 시험 이름 · 본 날짜** 세 개뿐이다.
--   점수도 등급도 없이 "6월 모의고사 봤다"만 적어도 저장된다. 성적을 강요하지 않는다.
--   grade(1~9)와 score(0~100)는 **둘 다 선택**이고, 있는 것만 추이에 찍힌다.
--
-- [누가 쓰나] 과외쌤이 자기 담당 학생에 대해서만. 학생은 **읽지도 쓰지도 않는다** —
--   이건 과외쌤이 학부모에게 전할 맥락이지 학생에게 보여줄 평가가 아니다.
--   (학생에게 노출할지는 별도 결정 사항이라 지금은 열지 않는다.)

create table if not exists exam_records (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references profiles(id) on delete cascade,
  student_id  uuid not null references profiles(id) on delete cascade,
  subject     subject_code not null,
  exam_name   text not null,
  taken_on    date not null,
  -- 등급은 1~9, 점수는 0~100. 둘 다 없어도 된다(있는 것만 그래프에 찍힌다).
  grade       integer,
  score       integer,
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint exam_records_name_not_blank check (btrim(exam_name) <> ''),
  constraint exam_records_grade_range check (grade is null or grade between 1 and 9),
  constraint exam_records_score_range check (score is null or score between 0 and 100),
  -- 코멘트는 "한 줄"이다. 길면 리포트 카드가 무너진다.
  constraint exam_records_comment_len check (comment is null or length(comment) <= 200)
);

create index if not exists exam_records_student_taken_idx
  on exam_records (student_id, subject, taken_on);

comment on table exam_records is
  '과외쌤이 적는 시험 기록. 리포트의 등급 추이에 누적된다. 필수는 과목·이름·날짜뿐.';

alter table exam_records enable row level security;

-- 과외쌤은 **active 연결된 학생**의 기록만 읽고 쓸 수 있다.
-- teacher_id = auth.uid() 만 보면 남의 학생 id 를 넣어 행을 만들 수 있다 → 연결도 함께 본다.
drop policy if exists exam_records_teacher_rw on exam_records;
create policy exam_records_teacher_rw on exam_records for all
  using (
    teacher_id = auth.uid()
    and exists (
      select 1 from connections c
      where c.teacher_id = auth.uid() and c.student_id = exam_records.student_id and c.status = 'active'
    )
  )
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from connections c
      where c.teacher_id = auth.uid() and c.student_id = exam_records.student_id and c.status = 'active'
    )
  );

create or replace function touch_exam_records_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_exam_records_updated_at_trigger on exam_records;
create trigger touch_exam_records_updated_at_trigger
before update on exam_records
for each row execute function touch_exam_records_updated_at();

-- ── 발송 상태 ────────────────────────────────────────────────────────────────
--
-- ⚠️ 실제 카톡/PDF 연동은 **이번 범위가 아니다.** 상태만 기록한다.
--   나중에 연동을 붙일 때 "무엇을 언제 어떤 경로로 보냈고 실패했는지"가 이미 남아 있어야
--   재시도·이력 화면을 다시 만들지 않는다.
--
--   reports.status / sent_at 은 "리포트가 발송됐는가"라는 한 덩어리 상태다.
--   채널이 여러 개(링크·카톡·PDF)이고 각각 실패할 수 있으므로 행으로 나눈다.
create table if not exists report_deliveries (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references reports(id) on delete cascade,
  channel     text not null,
  status      text not null default 'pending',
  -- 실패를 조용히 두지 않는다. 사람이 왜 실패했는지 볼 수 있어야 재시도할 수 있다.
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,

  constraint report_deliveries_channel_check check (channel in ('link', 'kakao', 'pdf')),
  constraint report_deliveries_status_check check (status in ('pending', 'sent', 'failed')),
  constraint report_deliveries_sent_at_matches
    check ((status = 'sent') = (sent_at is not null)),
  constraint report_deliveries_error_only_when_failed
    check (status = 'failed' or error is null)
);

create index if not exists report_deliveries_report_idx on report_deliveries (report_id, created_at desc);

comment on table report_deliveries is
  '리포트 발송 시도 기록(채널별). 실연동 전에는 link 만 실제로 동작하고 나머지는 상태만 남는다.';

alter table report_deliveries enable row level security;

-- 리포트를 만든 과외쌤만 자기 리포트의 발송 이력을 보고 남길 수 있다.
drop policy if exists report_deliveries_teacher_rw on report_deliveries;
create policy report_deliveries_teacher_rw on report_deliveries for all
  using (
    exists (select 1 from reports r where r.id = report_deliveries.report_id and r.teacher_id = auth.uid())
  )
  with check (
    exists (select 1 from reports r where r.id = report_deliveries.report_id and r.teacher_id = auth.uid())
  );

-- ── 리포트 본문 칸 ───────────────────────────────────────────────────────────
--
-- 기존 reports.teacher_comment 하나로는 B7 의 글 **세 칸**을 담을 수 없다.
-- jsonb 에 뭉치지 않고 컬럼으로 나눈 이유: 학부모 웹뷰·PDF 가 각 칸을 다른 스타일로
-- 렌더하고, 나중에 AI 초안이 칸별로 들어온다(칸 구조가 곧 계약이다).
alter table reports
  add column if not exists home_support text,
  add column if not exists next_week_focus text;

comment on column reports.teacher_comment is '선생님 코멘트(B7 첫째 칸). 1단계에서는 과외쌤이 직접 작성한다.';
comment on column reports.home_support is '가정에서 도와주시면(B7 둘째 칸).';
comment on column reports.next_week_focus is '다음 주 방향(B7 셋째 칸).';
comment on column reports.ai_draft is
  'AI 초안 원본. 2단계에서 채운다 — teacher_comment 를 덮어쓰지 않고 따로 두어 사람이 고친 내용을 보존한다.';
