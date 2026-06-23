# DESIGN-PROGRESS — 카탈로그 기준 전면 재디자인 로그

> docs/ui-catalog(student-mobile 73 · student-tablet 60 · teacher-desktop 36 · teacher-mobile 28 · teacher-tablet 18)
> 기준으로 전 화면을 겉모습·반응형만 재디자인. 기능/데이터/RLS/테스트 무변경.
> 토큰 규칙: 인디고 기본 · 불꽃 주황은 '지금/시작/연속/긴급'에만 · Pretendard · 칩 nowrap ·
> 학생=따뜻 / 과외쌤=중립 프로 SaaS. 프라이버시(또래 익명·focus 영상 미저장·공개범위)·가격 상수·
> 앱구독료↔수업료 분리는 절대 불변. 검증: `corepack pnpm -w lint && typecheck && test && build` green.

## 이전 단계 (main 머지 완료)
- 1단계: 학생 셸(하단 5탭) + 홈(오늘) 3변형 + 공통 정리(마일스톤 표식·디버그 카피·과외쌤 디버그 사이드바 제거). (a21b207)
- fix: 빈 생년월일 보호자 동의 판단 무-throw. (564b333)
- 재사용 디자인 시스템: `apps/student/src/m2Screens.tsx` 내 AppShell·HomeCard·SoftTag·StudyTodoRow·
  HomeHeader·tokens 스타일. 이후 그룹은 이 시스템을 재사용해 일관성 유지.

---

<!-- 그룹별 기록을 여기에 누적 -->

## G1 — 학생 플래너 (할일/시간표/캘린더) ✅
- **device**: student-mobile (08·09·10·12·13).
- **손본 화면**: `apps/student/src/m2Screens.tsx` 플래너 3뷰 + `app/todo/new.tsx`.
  - 세그먼트: 화이트-필 스타일(track=canvas, active=흰 카드).
  - 할 일: 주간 스트립(오늘 강조) + 공부시간 누적 바(과목별 스택+범례) + 선생님 숙제(편집 잠김)·내 플래너 목록(StudyTodoRow 재사용) + "+ 할 일 추가". 작성/편집은 별도 폼(작성 모드에서만 노출, /todo/new는 폼 바로 열림).
  - 시간표: 활동 칩 범례 + "쌤 수업 자동 연결" 잠금 배너 + 일/주 세그먼트 + 요일 칩 + 색상 블록 카드(활동색).
  - 캘린더: 월 그리드(공부량 3단계 음영) + 오늘/선택일 표시 + 선택일 카드(시간표·할일·"+ 추가") + 월 통계 2카드.
- **기능 유지**: todos/timetable_blocks/study_sessions CRUD·토글·AI검사 잠금 그대로. 데이터/RLS 무변경.
- **카탈로그와 남은 차이(의도)**:
  - 과목/활동 카테고리 색 = 토큰 팔레트(brand/success/warning/muted/ink). 카탈로그의 채도 높은 주황/노랑 대신 토큰 사용(불꽃 주황은 '지금/시작/연속/긴급'에만 규칙). 블록 텍스트는 `meetsAA`로 흰/잉크 자동 선택(AA 보장).
  - 시간표 = 위치 기반 멀티-데이 그리드 대신 색상 블록 카드 목록(일/주). 캘린더 음영 = 연속 그라데이션 대신 토큰 3단계.
  - 주간 스트립 '오늘' = 인디고(카탈로그 주황) — 토큰 규칙.
- **검증**: lint/typecheck/test/build green. 8081에서 할일·시간표·캘린더 3뷰 무크래시 렌더 확인.
