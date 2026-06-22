# PROGRESS — 쌤플래너 자율 빌드 로그

> 마일스톤 단위 누적 기록. 각 항목: 무엇을 / 실제 동작 vs mock / 검증 결과 / 다음 / 막힌 점.
> 검증은 `corepack pnpm -w lint && typecheck && test && build` + 원격 Supabase RLS 통합 테스트 기준.

---

## M0~M3 (이전 세션, main 머지 완료)
- M0 스캐폴딩, M1 인증·연결, M2 홈·플래너·할일, M3 타이머·집중모드(온디바이스 졸음 감지).
- M3 2-B(PR #5)는 이번 세션 시작 시 검수 후 squash merge(커밋 469cb6c).
  - 배포 노트: focus 마이그레이션 `20260623010000` → `20260623011000` 순서대로 적용 필수(커밋 메시지에 명시).

---

## M4 — AI 완료검사 (flagship)  ✅ 구현·검증 완료
브랜치: `codex/m4-ai-homework-check`

### 무엇을
- **AI 판정 서버 권위화**: `apply_homework_ai_verdict` RPC(service_role 전용) + `guard_homework_submission_fields` 트리거.
  - 인증 사용자(학생·과외쌤)는 `ai_verdict/ai_confidence/ai_reason`를 직접 못 씀(서버만).
  - 학생은 `teacher_status/teacher_comment/resubmit_requested`를 못 바꿈(과외쌤 전용).
  - 마이그레이션 `20260624000000_m4_homework_ai_check.sql` (+ schema.sql 미러).
- **숙제 사진 버킷**: `homework-photos`(비공개) + 학생 본인 폴더 RLS. 마이그레이션 `20260624010000`.
- **순수 로직**(`packages/shared/src/m4.ts`): `getStubHomeworkVerdict`(통과/미흡/애매 결정적 스텁), `getHomeworkResultView`(과외생=쌤 코멘트 / 혼공=AI 단독), `createTeacherReviewPatch`(확인/반려), `summarizeReviewQueue`.
- **학생 화면**(`apps/student/src/m4Screens.tsx` + `app/homework/[id]/{submit,result,index}.tsx`): 제출(C4)→업로드 실패(H2)→AI 검사(G1)→검사 실패(H3) 폴백→결과(J9, 과외생 쌤 코멘트/혼공 AI 단독), 반려 시 "다시 제출"(K-루프), "쌤 확인 전"(J8).
- **과외쌤 화면**(`apps/teacher/src/app/m4.tsx` + `homework/review/page.tsx`, B5): 검사 큐 요약 + 확인/반려(다시 제출 요청).
- **Edge Function**(`supabase/functions/ai-homework-check/index.ts`): 제출→판정→`apply_homework_ai_verdict` 기록. **현재 STUB**(Anthropic 키 없이 결정적 응답).

### 실제 동작 vs mock
- **실제**: 제출 저장, 서버 권위적 판정 기록(RPC), 공개범위 RLS, 과외쌤 확인/반려, 재제출 루프, DB 마이그레이션은 원격에 push 완료.
- **STUB(명시)**:
  - AI 판정 = 결정적 스텁(`getStubHomeworkVerdict`, 사진 장수 기반). 키 준비 후 Edge Function 내부를 Anthropic 비전으로 교체.
  - 숙제 사진 **캡처/바이트 업로드**는 실기기 전용 → 이 헤드리스 빌드에선 첨부 장수만 경로 메타로 기록(버킷/정책은 준비됨).
- **사람 대기(배포)**: `ai-homework-check` Edge Function의 **프로덕션 배포는 보류**(자동 모드에서 "프로덕션 배포"는 STOP 조건). 함수는 레포에 완성되어 있고, 미배포 상태에선 앱이 H3 폴백("제출만 두고 나중에 결과")으로 우아하게 처리됨. 사람이 `supabase functions deploy ai-homework-check`로 활성화.

### 검증 결과
- `lint` ✅ / `typecheck` ✅ / `test` ✅(전체 64개: shared 60 + student 2 + teacher 2) / `build` ✅(4 패키지).
- 원격 Supabase RLS 통합 테스트 ✅ `m4.homework.rls.integration.test.ts`:
  - 학생이 ai_* 위조(insert/update) → 차단됨.
  - service_role만 판정 기록 가능 → 학생이 결과 조회.
  - `share_homework_photos` ON일 때만 과외쌤 조회, OFF면 안 보임.
  - 과외쌤 반려 → 학생은 teacher_* 변경 불가.
  - 혼공생 제출은 어떤 과외쌤에게도 안 보임(AI 단독).
- 프라이버시 grep: `focusCamera.native.tsx` 등 집중 파일에 upload/photo/record/storage 없음(무변경, 재확인).

### 다음 / 막힌 점
- 다음: M5(AI 공부량 추천·리포트 + 학부모 공유 링크).
- 막힌 점 없음. (Edge Function 배포만 사람 승인 대기 — 블로커 아님.)
