# 화면 ↔ 라우트 매핑 — 쌤플래너

> Codex가 라우팅을 **결정적으로** 구현하도록 화면코드 → 경로 → 상태/변형 → 주요 데이터(테이블/엔드포인트)를 고정한다.
> 같은 코드의 변형(예: C2 오늘/제로/혼공)은 **같은 라우트의 상태**로 처리한다(별도 경로 아님).
> 라우트는 권장값 — 학생=Expo Router, 과외쌤=Next.js App Router. 스택 변경 시 경로 규칙만 맞춰 조정.

## 학생 앱 (Expo Router) — 탭: today · planner · class · ai · records

| 코드 | 화면 | 라우트 | 상태/변형 | 주요 데이터 |
| --- | --- | --- | --- | --- |
| C1 | 온보딩·연결 | `/onboarding/connect` | 코드 입력 | invite_codes, connections |
| C2 | 오늘(홈) | `/(tabs)/today` | **기본=과외생** | study_sessions(오늘), todos, connections |
| C2 | 제로 홈 | `/(tabs)/today` | 데이터 0 상태 | — |
| C2 | 혼공 홈 | `/(tabs)/today` | 연동 없음 상태 + 또래 랭킹 | study_sessions(또래 랭킹) |
| C3 | 타이머 | `/timer` | 과목 선택 | study_sessions |
| C4 | 숙제 제출 | `/homework/[id]/submit` | 사진 업로드 | todos, homework_submissions(+Storage homework-photos) |
| C5 | 플래너 | `/(tabs)/planner` | 할일 탭(기본) | todos |
| C5 | 시간표 | `/(tabs)/planner?view=timetable` | 일/주 세그먼트 | timetable_blocks |
| C5 | 캘린더 | `/(tabs)/planner?view=calendar` | — | todos, study_sessions |
| C5 | 혼공/제로 플래너 | `/(tabs)/planner` | 상태 변형 | — |
| K1 | 할 일 편집 | `/todo/[id]/edit` | 신규=`/todo/new` (모달 가능) | todos |
| C6 | 우리 반 | `/(tabs)/class` | 과외생만 | connections, study_sessions |
| C7 | AI 추천 | `/(tabs)/ai` | 게이팅(무료/프리미엄) | ai_recommendations, ad_unlocks |
| C8 | 나의 리포트 | `/report` | 게이팅 | reports, ad_unlocks |
| C9 | 결제(페이월) | `/subscribe` | 바텀시트 | student_subscriptions(IAP) |
| F1 | 집중 온보딩 | `/focus/intro` | — | — |
| F2 | 집중 세션 | `/focus/session` | 진행 | study_sessions(focus_mode), focus_checks |
| F3 | 졸음 환기 A/B | `/focus/session` | 세션 내 모달 | focus_checks |
| F4 | 집중 요약 A/B | `/focus/summary` | 종료 후 | study_sessions |
| F5 | 집중 리포트 | `/focus/report` | — | study_sessions(추이) |
| F6 | 집중 설정 | `/focus/settings` | — | (설정값) |
| G1 | 숙제검사 로딩 | `/homework/[id]/submit` | 로딩 상태 | Edge: ai-homework-check |
| G2 | 리포트 생성 로딩 | `/report` | 로딩 상태 | Edge: ai-report-draft |
| G3 | AI추천 분석 로딩 | `/(tabs)/ai` | 로딩 상태 | Edge: ai-study-rec |
| G4 | 카메라 권한 요청 | `/focus/permission` | 권한 | OS 권한 |
| G5 | 카메라 권한 복구 | `/focus/permission` | 거부 후 상태 | OS 설정 |
| G6 | 공개범위 동의 | `/onboarding/disclosure` | 연결 시 | disclosure_settings |
| H1 | 네트워크 오류 | (전역) | 상태/모달 | — |
| H2 | 업로드 실패 | `/homework/[id]/submit` | 상태 | — |
| H3 | AI검사 실패 | `/homework/[id]/submit` | 상태 | — |
| H4 | 결제 실패 | `/subscribe` | 상태 | — |
| I1 | 구독 관리 | `/settings/subscription` | 해지 포함 | student_subscriptions |
| I2 | 공부 기록 | `/(tabs)/records` | — | study_sessions |
| I3 | 계정 설정 | `/settings` | — | profiles |
| I4 | 알림 센터 | `/notifications` | — | notifications |
| J1 | 회원가입 | `/signup` | 소셜+이메일 | auth |
| J2 | 약관 동의 | `/signup/terms` | — | (약관) |
| J4 | 첫 프로필 | `/signup/profile` | — | profiles |
| J5 | 광고 보상 재생 | (모달) | — | ad_unlocks |
| J6 | 언락 완료 | (모달/상태) | — | ad_unlocks |
| J7 | 구독 완료 | `/subscribe/done` | — | student_subscriptions |
| J8 | 검사결과 대기 | `/homework/[id]` | 쌤 확인 전 | homework_submissions |
| J9 | 검사결과 통과/미흡/애매 | `/homework/[id]/result` | 상태(verdict) · **과외생** | homework_submissions |
| J10 | 프로필 편집 | `/settings/profile` | — | profiles |
| J11 | 알림 설정 | `/settings/notifications` | — | (설정) |
| J12 | 공개범위 재설정 | `/settings/disclosure` | — | disclosure_settings |
| J13 | 연동 해제 | `/settings/connection` | 확인 | connections(status=disconnected) |
| J14 | 빈 공부기록 | `/(tabs)/records` | 빈 상태 | — |
| J15 | 빈 알림 | `/notifications` | 빈 상태 | — |
| J16 | 학부모 웹뷰 | `/r/[token]` | 인증 없음·토큰 | Edge: report-share, reports |
| — | 다시 제출 요청 진입 | `/(tabs)/today` 카드 → `/homework/[id]` | 반려 상태 | homework_submissions(resubmit_requested) |
| — | 혼공 검사 통과/미흡/애매 | `/homework/[id]/result` | 상태 · **혼공(AI 단독)** | homework_submissions(teacher_status 미사용) |
| — | 비밀번호 찾기 | `/forgot` | — | auth |
| — | 새 비밀번호 설정 | `/reset` | — | auth |
| — | 연결 상태 핸드셰이크 | `/onboarding/connect/status` | pending/active/rejected | connections |
| — | 약관·개인정보 뷰어 | `/legal/[doc]` | — | (약관) |
| — | 회원 탈퇴/최종확인/완료 | `/settings/account/delete` | 3단계 | auth, cascade |
| — | 푸시 권한 안내/거부 | `/onboarding/push` (또는 모달) | — | push_tokens |
| — | 강제 업데이트 / 점검 중 | (전역 게이트) | 앱 레벨 | — |
| — | 첫 사용 코치마크 | (오버레이) | 1회 | — |

## 과외쌤 앱 (Next.js App Router)

| 코드 | 화면 | 라우트 | 상태/변형 | 주요 데이터 |
| --- | --- | --- | --- | --- |
| A1 | 로그인 | `/login` | 소셜+이메일 | auth |
| A2 | 회원가입 | `/signup` | — | auth, profiles |
| A3 | 첫 프로필 | `/onboarding/profile` | — | profiles |
| A4 | 첫 학생 안내 | `/onboarding/first-student` | 빈 대시보드 | — |
| B1 | 대시보드 | `/dashboard` | — | connections, homework_submissions, study_sessions, billing |
| B2 | 학생 목록 | `/students` | — | connections, profiles |
| B2-1 | 학생 추가·초대 | `/students/invite` | 코드 발급 | invite_codes |
| B3 | 학생 상세 | `/students/[id]` | 탭 컨테이너 | profiles, v_teacher_study_sessions |
| B3 | 플랜·숙제 | `/students/[id]/plan` | 탭 | todos |
| B3 | 공부 기록 | `/students/[id]/records` | 탭(공개범위 필터) | v_teacher_study_sessions |
| B3 | 약점 | `/students/[id]/weakness` | 탭 | reports/집계 |
| B3 | 리포트 탭 | `/students/[id]/reports` | 탭 | reports |
| B4 | 숙제 출제 | `/students/[id]/homework/new` | **AI 검사 여부 결정** | todos(source=teacher, ai_check, locked) |
| B5 | 숙제 검사 | `/homework/review` | 큐(통과/애매/미흡) | homework_submissions |
| B6 | 수업 리포트 | `/students/[id]/reports/lesson/new` | 빌더 | reports(type=lesson) |
| B7 | 주간 리포트 | `/students/[id]/reports/weekly/new` | 빌더+AI 초안+발송 | reports(type=weekly), Edge: ai-report-draft/report-share |
| B8 | 설정 | `/settings` | — | profiles |
| B9 | 쌤 개인 도구(내 노트) | `/tools` | — | (노트) |
| B10 | 검색·정렬·필터 | `/students?q=&sort=` | — | connections |
| B11 | 알림 센터 | `/notifications` | — | notifications |
| — | 연결 요청 핸드셰이크 | `/students/requests` | 수락/거절 | connections(pending) |
| — | 학생 연결 해제 | `/students/[id]/disconnect` | 확인(과금 감소) | connections(disconnected), billing |
| — | 학생별 설정 | `/students/[id]/settings` | 검사 과목·주기 | per_student_settings, disclosure(읽기) |
| — | 비밀번호 재설정 | `/reset` | — | auth |
| — | 약관·개인정보 뷰어 | `/legal/[doc]` | — | (약관) |
| — | 회원 탈퇴 | `/settings/account/delete` | 확인 | auth, cascade |
| — | 구독·결제(앱 구독료) | `/billing` | active 학생×₩2,900 | teacher_subscriptions, billing_invoices |
| — | 구독 결제 실패·미납 | `/billing` | dunning 상태 | billing_invoices(past_due) |
| — | 구독 해지·일시정지 | `/billing/cancel` | — | teacher_subscriptions(canceled/paused) |
| — | 수업·수업료 관리 | `/lesson-fees` | **수기 트래커(결제 아님)** | lesson_fees |
| — | 리포트 발송 완료/실패 | `/students/[id]/reports/...` | 상태 | reports(status=sent) |
| — | 학부모 리포트 히스토리 | `/r/[token]/history` | 웹뷰 | reports, report_views |
| — | 카톡 링크 만료 | `/r/[token]` | 만료 상태 | reports(share_expires_at) |
| — | 초대코드 대기 | `/students/invite` | pending 상태 | invite_codes |
| — | 학생 검색 0건 | `/students` | 빈 상태 | — |

## 공유/웹뷰
- 학부모 리포트(`/r/[token]`)는 **인증 없이** `share_token`으로만 접근. Edge Function `report-share`가 토큰 검증 후 데이터 반환(테이블 직접 노출 금지) + `report_views` 기록. 만료(`share_expires_at`) 처리.

## 라우트 그룹 메모
- 학생: `(tabs)` 그룹 = today/planner/class/ai/records. 그 외는 스택(모달 포함).
- 과외쌤: `(auth)` = login/signup/onboarding, `(app)` = dashboard 이하(가드: 로그인+온보딩 완료). `/r/[token]`은 공개.
