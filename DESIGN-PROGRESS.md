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

## G2 — 타이머(C3) + 집중 모드(F1~F2) ✅ (F4/F5 부분)
- **device**: student-mobile (06·18·19·22·24).
- **손본 화면**: `apps/student/src/timerScreen.tsx` (C3 타이머 + F2 집중 세션, 같은 화면).
  - 다크 테마 전환. 상단 back + "집중 타이머"(집중 모드 시 "👁 집중 모드 ON" 주황 필).
  - 과목 칩(다크) + 원형 링(시간 중앙·과목·기록 상태점) — 집중 모드면 링 주황(=지금/집중, 토큰 규칙 부합), 일반은 인디고.
  - 컨트롤: 메인 재생/일시정지(흰 원) + 종료(주황 원). 집중 모드 배너(👁 집중 모드 · 졸음 점검 · "영상은 기기를 떠나지 않아요" + 토글).
  - 집중 세션 시 `FocusCameraPanel`(졸음 점검) 유지, "멈추면 오늘 플래너에 자동 기록" 카피.
  - 개발 흔적(키커·live·notice·하단탭) 제거.
- **기능 유지**: study_sessions 타이머 start/pause/resume/end, save_focus_check RPC, 카메라 포그라운드 전용·영상 미저장 그대로. F1 집중 온보딩 카드(`FocusIntroCard`)는 프라이버시 카피 유지.
- **카탈로그와 남은 차이(의도/범위)**:
  - 원형 링 = SVG 진행 호 대신 토큰 테두리 링(시간 중앙). 컨트롤 좌측 reset(↺) 버튼 생략(reset 의미 없음) → 재생/일시정지+종료 2버튼.
  - **F4 집중 요약(22)·F5 집중 리포트(24)는 이번 커밋에서 다크 타이머 우선 — 기능 유지·라이트 화면은 후속 다듬기 대상**(DESIGN-PROGRESS 갱신 예정).
- **검증**: lint/typecheck/test/build green. 8081에서 타이머 다크 렌더·과목칩·링·컨트롤·집중모드 배너(프라이버시 카피) 무크래시 확인.
