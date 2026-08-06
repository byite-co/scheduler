// 기능 플래그.
//
// 여기 있는 값은 **환경변수가 아니라 코드 상수**다. 이유:
//
//  1) 출처가 하나여야 한다. 환경변수로 두면 학생 앱(EXPO_PUBLIC_*)·과외쌤 앱(NEXT_PUBLIC_*)·
//     Edge Function 시크릿까지 **세 곳**을 맞춰야 하고, 어긋나면 "학생 화면엔 안 보이는데
//     과외쌤 화면엔 보인다" 또는 "표시는 막았는데 호출은 계속돼 돈이 나간다" 가 된다.
//     이 레포는 규칙을 두 곳에 둬서 갈라진 사고를 이미 여러 번 겪었다.
//  2) 클라이언트 환경변수는 애초에 보안 경계가 아니다. EXPO_PUBLIC_/NEXT_PUBLIC_ 은 번들에
//     그대로 들어간다. 서버 차단은 어차피 서버에 있어야 한다.
//  3) 이 플래그는 "환경"이 아니라 "코드 상태"에 묶인다. 재설계가 끝나기 전까지는
//     스테이징에서도 프로덕션에서도 보여선 안 된다 — 환경마다 달라야 할 이유가 없다.
//  4) 검증할 수 있다. 상수는 CI 에서 값과 쌍둥이 일치를 단정할 수 있고, 환경변수는 못 한다.

/**
 * AI 숙제검사 **판정 결과를 사용자에게 보여줄지**.
 *
 * `false` 면:
 *   · 학생 제출·사진 업로드·과외쌤의 사진 열람은 **그대로 동작한다**
 *   · AI 검사를 호출하지 않는다(비용 0). Edge Function 도 같은 값으로 스스로 거절한다
 *   · 학생·과외쌤 화면에 verdict·확신도·reason 을 표시하지 않는다
 *   · 이미 저장된 `homework_check_attempts` 와 `homework_submissions.ai_*` 는 **지우지 않는다**.
 *     표시만 막는다
 *
 * 기본값이 `false` 인 이유 — 2026-08-07 실제 모의고사 사진 3장으로 측정한 결과,
 * 다 푼 페이지를 보고 "3번, 4번, 5번이 미작성 상태입니다" 를 confidence 0.95 로 냈고
 * 인쇄된 문제 지문의 소제목을 빈칸이라고 단정했다. 6회 전부 confidence 0.95 로
 * 신호가 없었고 `ambiguous` 로 넘긴 적이 한 번도 없다. 프롬프트 문구를 다듬는 문제가
 * 아니라 출력 구조를 바꿔야 하는 문제라, 재설계가 끝날 때까지 노출을 막는다.
 *
 * ⚠️ 이 상수를 `true` 로 바꾸는 것은 **제품 결정**이다. 되돌리는 절차는
 *    docs/PROJECT-GUIDE.md §3-2 를 봐라. 최소한 판정 정확도 재측정 결과가 있어야 한다.
 *
 * ⚠️ Edge Function(`supabase/functions/ai-homework-check/index.ts`)에 같은 이름의 상수가
 *    **쌍둥이로** 있다. Deno 는 이 패키지를 import 할 수 없어서다. 스키마 테스트가 두 값이
 *    같은지 대조한다 — 한쪽만 바꾸면 CI 가 깨진다.
 */
export const AI_CHECK_RESULTS_ENABLED = false;

/**
 * 플래그가 꺼진 동안 학생에게 보여줄 안내.
 * "실패" 로 읽히지 않게, 제출이 남았다는 사실과 다음에 일어날 일을 알려준다.
 */
export const AI_CHECK_PAUSED_STUDENT_NOTICE_TUTORED =
  "제출됐어요. 선생님이 확인해 주실 거예요.";

/**
 * 혼공생(연결 없는 학생)용 안내.
 * 혼공생은 AI 검사가 유일한 피드백 경로라 "선생님이 확인" 이라고 할 수 없다.
 */
export const AI_CHECK_PAUSED_STUDENT_NOTICE_SOLO =
  "제출됐어요. 지금은 자동 확인을 잠시 멈춰 뒀어요. 사진은 그대로 저장돼 있어요.";

/** 과외쌤 화면에서 AI 판정 칸이 사라진 이유를 알려준다(빈 자리로 두면 고장으로 보인다). */
export const AI_CHECK_PAUSED_TEACHER_NOTICE =
  "AI 자동 확인은 정확도 재점검 때문에 잠시 멈춰 뒀어요. 사진을 보고 직접 확인해 주세요.";

export function getAiCheckPausedStudentNotice(options: { isTutored: boolean }): string {
  return options.isTutored
    ? AI_CHECK_PAUSED_STUDENT_NOTICE_TUTORED
    : AI_CHECK_PAUSED_STUDENT_NOTICE_SOLO;
}
