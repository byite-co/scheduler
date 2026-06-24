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

## G3 — 또래 탭(class) + 기록 탭(records) ✅
- **device**: student-mobile (14·37).
- **손본 화면**: `apps/student/src/m2Screens.tsx` — placeholder였던 `StudentClassScreen`·`StudentRecordsScreen`을 실제 구현으로 교체.
  - 또래/우리 반: 과외생="우리 반"(연결 수 카드)+익명 또래집계, 혼공="또래"(익명 집계). 최근 14일 공부 흐름 스트립.
  - 기록: 일/주/월 세그먼트 + 통계 2카드(이번 주 공부시간 다크 / 연속 기록 flame) + 요일별 바 차트(오늘 강조) + 과목별 비중 스택 바+범례.
- **기능 유지**: study_sessions·connections·peer ranking RPC 그대로. **또래 익명성 유지**(STOP 조건 준수).
- **카탈로그와 남은 차이(의도)**:
  - **우리 반/또래 = 카탈로그의 실명 리더보드(한지우·윤하늘…) 대신 익명 집계**(나의 백분위·또래 평균·최근 흐름). 프라이버시/RLS 규칙 우선 — 실명·개인 공부시간 미노출.
  - 기록 일/월 범위는 주(week) 계산 재사용(범위 전환 데이터 분기 단순화). 요일 차트·과목 비중은 토큰 색.
  - "최고 N일 연속"은 데이터 미보유 → 현재 연속만 표시.
- **검증**: lint/typecheck/test/build green. 8081에서 /class(익명 유지)·/records 무크래시 렌더 확인.

---

## G4 — 숙제 제출(C4)·결과(J9)·리포트(C8 게이팅) ✅
- **device**: student-mobile (07·47/48/49·16).
- **손본 화면**: `apps/student/src/m4Screens.tsx`(숙제 제출/결과/상세), `m5Screens.tsx`(MyReportScreen 게이트).
  - 제출(C4): BackHeader + 과목 칩 + "검사 범위" 카드 + 사진 슬롯(📷/＋추가) + "✨ AI 1차 확인" 안내 + 제출하기 + "쌤 확인 전" 안내(과외생).
  - 결과(J9): 중앙 verdict hero(톤별 원형 아이콘·헤드라인) + "부족한 부분" 카드 + 선생님 코멘트(과외생)/AI 단독(혼공) + 다시 제출.
  - 리포트(C8): 잠금 프리뷰(🔒 준비됐어요) + "광고 보고 무료로 열기"(mock) + "월 구독하고 광고 없이 무제한"(→/subscribe).
  - 하드코딩 hex(#E6F7EF 등)를 `tints` 토큰으로 교체.
- **기능 유지**: homework_submissions 제출·ai-homework-check invoke·getHomeworkResultView 분기·ad_unlocks 게이팅 그대로. **AI 판정·광고는 mock 유지(실연동 금지)**.
- **카탈로그와 남은 차이(의도)**: 사진 캡처/업로드는 실기기 전용→장수 메타만(기존 stub 유지). "다시 제출"·verdict 강조는 토큰 색(불꽃 주황 비-CTA 미사용, 톤 카드는 tints).
- **검증**: lint/typecheck/test/build green. 8081에서 /report 게이팅·숙제 화면 무크래시 렌더 확인.

## G5 — 학생 설정·프로필·알림·구독·회원 탈퇴 ✅
- **device**: student-mobile (설정/알림/구독/탈퇴 계열).
- **손본 화면**: `apps/student/src/m7Screens.tsx`(설정 허브·알림·프로필·탈퇴·푸시·약관·시스템), `m6Screens.tsx`(구독), `m5Screens.tsx`(kicker).
  - 설정 허브: 프로필 헤더 카드 + 섹션 그룹(계정/알림/기타) + 아이콘 행(구분선). 카탈로그 톤.
  - flame kicker → muted(규칙: 불꽃 주황은 지정 용도만). 하드코딩 hex(#EEF2FF) → `tints.brandSoft`.
  - **버그 수정**: 설정 허브의 `<Link asChild>` 자식 Pressable에 style 배열 → Slot 에러로 화면이 안 뜨던 것 `StyleSheet.flatten`으로 해결(DOM 검증으로 포착).
- **기능 유지**: notifications 읽음·딥링크, delete_my_account RPC, push_tokens mock 등록, 구독 mock 전이, 가격 상수(PRICE_STUDENT_PREMIUM_KRW) 그대로.
- **카탈로그와 남은 차이(의도)**: 페이월(C9)은 풀스크린 카드(바텀시트 대신). 결제·푸시는 mock 유지.
- **검증**: lint/typecheck/test/build green. 8081에서 /settings 그룹 렌더 확인(버그 수정 포함).

## G6 — 학생 가입/로그인 분리 ✅
- **device**: student-mobile (40 J1 가입 등).
- **손본 화면**: `apps/student/src/m1Screens.tsx` + 신규 `app/login/index.tsx`.
  - `AuthFrame`(앱 아이콘 히어로 + 제목 + 부제 + 폼 + 푸터) 신설.
  - **가입(/signup)**: "쌤플래너 시작하기" + 이메일/비번(placeholder) + "이메일로 가입" + "약관 동의하고 계속 →" + "이미 계정이 있나요? 로그인".
  - **로그인(/login, 신설)**: "다시 만나서 반가워요" + 이메일/비번 + "로그인" + "비밀번호 찾기" + "처음이신가요? 가입".
  - **"세션: 있음" 디버그 StatusBand 제거.** InputRow에 placeholder/optional label 추가. 하드코딩 #7A5700 → tints.warningStrong.
- **기능 유지**: supabase signUp/signInWithPassword 그대로. 이메일+비번 유지.
- **카탈로그와 남은 차이(의도)**: 소셜 로그인(카카오/Apple) 버튼 생략 — OAuth 미연동(범위 밖) + 카카오 브랜드 옐로는 토큰 외 색이라 토큰 규칙 우선. 이메일+비번만.
- **검증**: lint/typecheck/test/build green. 8081에서 /signup·/login 렌더 확인(빈 화면·Slot 함정 없음, 디버그 제거).

## G7 — 학생 태블릿 반응형 ✅
- **device**: student-tablet (01·03·06 등).
- **손본 화면**: `apps/student/src/m2Screens.tsx`(AppShell), `m4/m5/m6/m7Screens.tsx`(content maxWidth).
  - **공용 AppShell에 device 분기**(`useWindowDimensions`, width≥768=태블릿): 태블릿에서 카드 children을 **2열 그리드**(`tabletCell` flexBasis 47%)로 배치 + 컨테이너 maxWidth 1040. → 홈·플래너·또래·기록 전 탭에 일괄 반응형(중복 구현 없음).
  - 플로우 화면(숙제/리포트/구독/설정)은 태블릿에서 과폭 방지 위해 content maxWidth 720 + 중앙 정렬.
- **기능 유지**: 레이아웃만 분기, 데이터/로직 무변경.
- **카탈로그와 남은 차이(의도)**: 카탈로그의 정밀 마조너리(히어로+할일 좌 / 우리반+숙제 우 / 차트 풀폭)는 **순서 기반 2열 wrap**으로 근사(카드가 L-R-L-R 흐름). 플래너 시간표의 좌-목록/우-주간그리드 분할은 단일 컬럼 내 카드로 유지(그리드는 가로 스크롤). 타이머/가입은 기존 중앙 maxWidth로 태블릿 대응.
- **검증**: lint/typecheck/test/build green. 8081을 768px로 리사이즈해 홈 카드가 2열(좌 x≈24 / 우 x≈392)로 배치됨을 DOM 좌표로 확인.

## G8 — 과외쌤 IA + 인증/온보딩 ✅
- **device**: teacher-desktop (01 A1 로그인·05 B1 IA).
- **손본 화면**: `apps/teacher/src/app/m1.tsx` — `TeacherShell` 재구성 + `TeacherAuthLayout` 신설.
  - **사이드바 IA 셸**: 좌측 고정 사이드바(브랜드 + 대시보드/학생 관리/숙제 검사/리포트/구독·정산/설정 + 프로필·로그아웃 푸터) + 메인(헤더 title/subtitle/actions + children). `active` 기반 nav 하이라이트(prefix 매칭). 중립 프로 SaaS 톤.
  - **인증 스플릿 스크린**: 좌 브랜드 패널(인디고, "계획부터 인증까지…" + 1.2만+/94% 지표) + 우 폼. 로그인/가입/재설정이 사용.
  - **"세션: 있음/없음" 디버그(Auth 상태 StepList) 제거.** AuthForm은 이메일/비번 + 로그인 + 가입↔로그인 토글 + 비밀번호 재설정 링크.
  - 대시보드 헤더에 "+ 학생 초대" 액션.
- **기능 유지**: signUp/signInWithPassword/reset 그대로. m1 화면(대시보드·초대·요청·프로필·온보딩)이 새 셸 사용.
- **카탈로그와 남은 차이(의도)**: 소셜 로그인(카카오/구글/네이버) 생략(OAuth 미연동 + 토큰 외 색). 사이드바 아이콘은 유니코드(아이콘 라이브러리 미도입). 대시보드 **콘텐츠 자체(통계카드·집중관리 테이블·우측레일)는 G9**에서.
- **검증**: lint/typecheck/test/build green(teacher Next build 컴파일 성공=Tailwind 유효). 3000에서 /login 스플릿·/(대시보드) 사이드바 IA 렌더 확인, 디버그 제거 확인.

## G9 — 과외쌤 대시보드(B1) + 학생 관리(B2) ✅
- **device**: teacher-desktop (05 B1·06 B2).
- **손본 화면**: `apps/teacher/src/app/m1.tsx`(대시보드·학생 관리) + 신규 `app/students/page.tsx`.
  - **대시보드(B1)**: 통계 카드 4(담당 학생/대기 요청/거절/이번 달 구독료) + 좌 "학생 연결 현황"(ConnectionList) + 우 레일("이번 주 회차·수업료" + "숙제 검사 대기" 다크 CTA→/homework/review). `StatCard` 컴포넌트. `MetricPanel`(구식) 제거.
  - **학생 관리(B2, 신설 /students)**: 사이드바 "학생 관리" 타깃. 연결 요청(pending) + 연결된 학생(active) + 초대/요청 링크. → 404였던 nav 해결.
- **기능 유지**: connections/요청 수락·거절·구독료 계산 그대로. 가격 상수·구독료↔수업료 분리 무변경.
- **카탈로그와 남은 차이(의도/범위)**:
  - 카탈로그 대시보드의 **"집중 관리가 필요한 학생" 테이블(이름·수행률·공부시간)** 은 학생 프로필 join + `v_teacher_study_sessions`(공개범위 게이팅) 데이터 와이어링이 필요 → 이번엔 연결 현황/통계로 대체(데이터 작업은 별도). 학생 본인은 과외쌤에게 식별 가능(또래 익명성과 무관).
  - **B3 학생 상세 탭(08~12: 플랜·숙제/기록/약점/리포트)은 미구현** — `/students/[id]` 라우트+탭 컨테이너+공개범위 게이팅 데이터가 큰 작업이라 다음 라운드로.
- **검증**: lint/typecheck/test/build green(teacher Next build 컴파일). 3000에서 /(대시보드 통계·CTA)·/students 렌더 확인.

## G10 — 과외쌤 숙제 검사(B5) 사이드바 통합 ✅
- **device**: teacher-desktop (14 B5).
- **손본 화면**: `apps/teacher/src/app/m4.tsx`(숙제 검사) + `m1.tsx`(`TeacherShell` export).
  - `TeacherShell` + 최소 데이터 타입 `TeacherShellData` export → m4~m7이 사이드바 IA를 재사용할 수 있게 됨.
  - 숙제 검사(B5): 독립 `<main>` 레이아웃 → **사이드바 셸로 전환**(active="/homework/review"). 콘텐츠(요약 카드 통과/미흡/애매·검사 큐·확인/다시 제출)는 유지.
- **기능 유지**: homework_submissions RLS(공개범위 게이팅)·createTeacherReviewPatch·summarizeReviewQueue 그대로. AI 판정 mock 유지.
- **카탈로그와 남은 차이/범위**: **숙제 출제(B4, 13)** 화면은 미구현(새 라우트 `/students/[id]/homework/new` + todos source=teacher 작성 — 별도). 핸드셰이크/학생별 설정은 G8에서 이미 사이드바 IA 사용 중.
- **검증**: lint/typecheck/test/build green. 3000에서 /homework/review가 사이드바와 함께 렌더 확인.

## G11 — 과외쌤 리포트 빌더(B7) + 학부모 웹뷰 ✅
- **device**: teacher-desktop (16 B7) + 학부모 웹뷰(J16).
- **손본 화면**: `apps/teacher/src/app/m5.tsx`(리포트 빌더 → 사이드바 셸 전환, active="/reports/weekly"), `app/r/[token]/page.tsx`(브랜드 워드마크 추가).
  - 리포트 빌더: 학생 선택 → 주간 공부(공개범위 적용) → AI 초안(mock) → 담을 과목·코멘트 → 저장+공유 링크 발급 → 히스토리/만료. 콘텐츠 유지, 셸만 사이드바화.
  - 학부모 웹뷰: 인증 없이 토큰 전용 열람(만료/조회기록 RPC) 그대로 + "쌤플래너" 브랜드.
- **기능 유지**: create_report_share·get_shared_report·공개범위(v_teacher_study_sessions) RLS 무변경. AI 초안 mock.
- **카탈로그와 남은 차이/범위**: 수업 리포트(B6)는 주간(B7)과 동형이라 미분리. 빌더 차트는 토큰 색.
- **검증**: lint/typecheck/test/build green. 3000에서 /reports/weekly 사이드바 렌더 확인.

## G12 — 과외쌤 구독·결제 + 수업료 + 알림 사이드바 통합 ✅
- **device**: teacher-desktop (31·32·B11).
- **손본 화면**: `apps/teacher/src/app/m6.tsx`(앱 구독료·수업료 트래커), `m7.tsx`(알림 센터) → 모두 사이드바 셸 전환.
  - 앱 구독료(active×단가·던닝·인보이스, mock 전이) / 수업료 트래커(수기, "결제 아님·구독료와 별개" 경고 유지).
  - 알림 센터(읽음·딥링크). session 상태 추가해 셸 데이터 구성.
- **기능 유지**: mock_set_teacher_subscription·generate_teacher_invoice·lesson_fees·notifications 그대로. **가격 상수·앱구독료↔수업료 분리 무변경**.
- **검증**: lint/typecheck/test/build green. 3000에서 /billing(사이드바+분리 카피)·/lesson-fees 렌더 확인.

## G13 — 과외쌤 모바일/태블릿 반응형 ✅
- **device**: teacher-mobile (28장) / teacher-tablet (18장).
- **손본 화면**: `apps/teacher/src/app/m1.tsx`(`TeacherShell`).
  - 데스크탑/태블릿(≥768px): 좌측 사이드바 IA(기존).
  - **모바일(<768px): 사이드바 숨김 + 고정 하단 탭**(홈/학생/검사/리포트/정산/설정, 짧은 라벨+아이콘) + 상단 "쌤플래너" 워드마크. 섹션 하단 여백(pb-24)으로 탭 가림 방지.
  - 인증 스플릿(`TeacherAuthLayout`)은 모바일에서 브랜드 패널 숨김→폼만(이미 반응형).
  - 전 과외쌤 화면이 `TeacherShell`을 쓰므로 한 곳 수정으로 일괄 반응형(중복 없음).
- **기능 유지**: 레이아웃만 device 분기.
- **검증**: lint/typecheck/build green. 3000을 375px로 리사이즈해 하단 탭(top 761/bottom 812) 고정·사이드바 숨김 확인.

## 🎉 전체 완료 요약
- **학생 앱(모바일+태블릿)**: 셸+홈·플래너·타이머/집중·또래/기록·숙제/리포트·시스템·가입/로그인·태블릿 반응형 — 카탈로그화 완료.
- **과외쌤 앱(데스크탑+모바일/태블릿)**: IA 사이드바·인증·대시보드·학생 관리·숙제 검사·리포트/학부모 웹뷰·구독/수업료/알림·반응형 — 카탈로그화 완료.

## ✅ 잔여까지 전부 완료
- ~~과외쌤 **B3 학생 상세 탭(08~12)**~~ ✅ 완료(아래, /students/[id]).
- ~~과외쌤 **B4 숙제 출제(13)**~~ ✅ 완료(/homework/new).
- ~~대시보드 **집중 관리 테이블**~~ ✅ 완료.
- ~~학생 **F4 집중 요약**~~ ✅ 완료. F5 집중 리포트는 라이트 리스트 유지(허용 데이터 범위).
- 모두 기존 RLS/공개범위 게이팅 안에서 **읽기/허용된 쓰기만** — 데이터 모델·정책·익명성·가격·분리 무변경.

## (후속) B3 — 과외쌤 학생 상세 탭 ✅
- **device**: teacher-desktop (08~12 B3).
- **손본 화면**: 신규 `app/students/[id]/page.tsx`(클라이언트) — `TeacherShell` + 탭 컨테이너.
  - 탭: 플랜·숙제(todos) / 기록(v_teacher_study_sessions 주간 차트, 공개범위) / 약점(주간 최소 과목 신호) / 리포트(reports 목록 + 빌더 링크) + "+ 숙제 내기".
  - 대시보드 집중 테이블 행 → `/students/[id]` 연결.
  - **RLS 준수**: profiles/todos/v_teacher_study_sessions/reports 모두 기존 teacher 정책·공개범위 게이팅 내 읽기. 공개 안 한 데이터는 뷰가 가림.
- **검증**: lint/typecheck/test/build green. 3000 /students/[id] 사이드바+4탭 렌더·탭 전환 확인.

## (후속) B4 — 과외쌤 숙제 출제 ✅
- **device**: teacher-desktop (13 B4).
- **손본 화면**: `apps/teacher/src/app/m4.tsx`(`TeacherHomeworkAssign`) + 신규 `app/homework/new/page.tsx` + 검사 화면 "+ 숙제 내기" 액션.
  - 학생 선택(active 연결) + 제목/과목/마감/AI 완료검사 토글 → teacher-todo insert(source=teacher, locked, connection_id).
  - **RLS 준수**: `todos_teacher_rw` 정책(active 연결)으로 과외쌤 insert 허용, 학생은 잠금(트리거가 학생 차단). 가격/AI 무관.
- **검증**: lint/typecheck/test/build green. 3000 /homework/new 사이드바+폼 무크래시 렌더.

## (후속) 대시보드 집중 관리 테이블 ✅
- **device**: teacher-desktop (05 B1).
- **손본 화면**: `apps/teacher/src/app/m1.tsx`(대시보드) — `useDashboardStudents` 훅 + `StudentFocusTable`.
  - active 연결 학생의 **공개범위 게이팅 뷰(v_teacher_study_sessions)** + 프로필(이름) 읽기 → 이번 주 공부시간 적은 순 정렬, 아바타 이니셜·시간·주의/양호 배지. 학생은 과외쌤에게 식별 가능(또래 익명성과 무관).
  - **RLS/데이터 모델 무변경** — 기존 m5 리포트 빌더와 동일 읽기 패턴(공개 안 한 데이터는 뷰가 가림).
- **검증**: lint/typecheck/test/build green. 3000 대시보드 무크래시 렌더(연결 학생+공개 데이터 있을 때 테이블 표시).

## (후속) F4 — 학생 집중 요약 ✅
- **device**: student-mobile (22 F4).
- **손본 화면**: `apps/student/src/focusReportScreen.tsx`(summary 모드).
  - 중앙 hero: 집중% 원형 링(주황=집중/focus, 토큰 규칙 부합) + 점수별 헤드라인("집중 잘했어요!" 등) + 부제(공부시간·졸음) + 통계(공부시간/졸음/점검).
  - report 모드(F5)는 라이트 리스트 유지. **"영상은 기기를 떠나지 않아요" 프라이버시 카피·boolean 메타만 표시 유지.**
- **기능 유지**: study_sessions(focus_mode) 집계 그대로.
- **검증**: lint/typecheck/test/build green. 8081에서 /focus/summary hero 렌더·프라이버시 카피 확인.
각 그룹: main에서 브랜치 → 카탈로그 PNG → green → squash merge → 기록.
⚠️ 과외쌤 m4 패턴: `import { TeacherShell, TeacherShellData } from "./m1"` 후 `shellData={session,loading,message,profile:null,setMessage,refresh}` 구성해 래핑(m5~m7도 동일 적용 권장).

- **G11** 과외쌤 리포트 빌더(B6 수업/B7 주간, 15·16) + 학부모 공유/히스토리/만료(웹뷰 22/23). 파일: `m5.tsx`(reports), `app/r/[token]`. → m5도 TeacherShell 사이드바 채택.
- **잔여(다음 라운드 흡수)**: 과외쌤 B4 숙제 출제, B3 학생 상세 탭(08~12).
- **G12** 구독·결제(앱 구독료 mock)+수업·수업료(수기, 분리 유지)+설정·알림(m6/m7) — TeacherShell 채택.
- **G13** teacher-mobile/teacher-tablet 반응형.
- (후속) 학생 F4/F5 집중 요약·리포트.
- **G6** 가입/로그인 분리(이메일+비번 유지, 디버그 제거). 파일: `m1Screens.tsx`.
- **G7** 학생 태블릿(student-tablet 60장): 공용 컴포넌트 device 분기로 2열/넓은 카드 반응형.
- **G8~G13** 과외쌤(teacher-desktop 36 → teacher-mobile 28/teacher-tablet 18): IA 재구성·인증/온보딩, 대시보드/학생목록/상세, 숙제 출제·검사·핸드셰이크, 리포트 빌더·학부모 공유, 구독·수업료, 반응형.
- **불변(STOP)**: 또래 익명 · focus 영상 미저장·"기기를 떠나지 않아요" · 공개범위 · 가격 상수 · 앱구독료↔수업료 분리 · 실연동(AI/결제/푸시).
- **후속 다듬기**: G2의 F4 집중요약(22)/F5 집중리포트(24) 라이트 화면.
