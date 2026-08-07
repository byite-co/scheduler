// Anthropic API 공통 원시값 — 요금 계산, 에러 분류, 입력 한도.
//
// 프롬프트와 출력 스키마는 여기 없다. ./observation.ts 에 있다.
//
// 🚨 2026-08-07 이전에는 이 파일에 "완료 여부 판정" 프롬프트와 그 비전 호출 함수가
//    있었다. 실사진 측정에서 다 푼 페이지를 "3·4·5번 미작성"으로
//    confidence 0.95 에 단정했고(§3-2), 원인은 전역 판정을 시킨 것이었다 —
//    결론을 만들어야 한다는 압박이 환각을 유발했다. 그래서 판정을 걷어내고
//    **보이는 표시만 관찰**하는 구조로 교체했다. 되돌리지 마라.

/**
 * error_code 분류. attempt.error_code 에 그대로 들어가고, 사용자 메시지는
 * shared 의 HOMEWORK_CHECK_ERROR_MESSAGES 가 매핑한다(두 앱이 같은 문구를 쓰게).
 */
export type CheckErrorCode =
  | "photos_missing" // photo_paths 가 가리키는 객체가 Storage 에 없다
  | "photo_download_failed" // 다운로드 실패(네트워크/권한)
  | "photo_too_large" // 비전 입력 상한 초과
  | "auth_failed" // Anthropic 키 문제(401/403)
  | "rate_limited" // 429
  | "upstream_timeout" // 시간 초과
  | "upstream_error" // 5xx 등 그 외 API 실패
  | "response_malformed" // 응답이 기대 형식이 아니다
  | "unknown";

export class CheckError extends Error {
  constructor(readonly code: CheckErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CheckError";
  }
}

// ── 요금 ─────────────────────────────────────────────────────────────────────
// 요금이 바뀌면 이 상수만 고친다. 마이크로달러(1e-6 USD) 정수로 계산해 부동소수점 오차를 피한다.
// **모델을 바꾸면 이 값도 함께 바꿔야 한다** — 안 바꾸면 비용 기록이 조용히 틀린다.
// Claude Haiku 4.5 기준 100만 토큰당 입력 $1 / 출력 $5.
const INPUT_MICROS_PER_MTOK = 1_000_000;
const OUTPUT_MICROS_PER_MTOK = 5_000_000;

export function estimateCostUsdMicros(inputTokens: number, outputTokens: number): number {
  const input = Math.round((inputTokens * INPUT_MICROS_PER_MTOK) / 1_000_000);
  const output = Math.round((outputTokens * OUTPUT_MICROS_PER_MTOK) / 1_000_000);
  return input + output;
}

// 비전 입력 상한. 앱이 긴 변 1568px/JPEG q0.8 로 줄여 보내지만, 우회 업로드가 있을 수 있어
// 여기서도 막는다. Anthropic 요청 전체 크기 제한(약 32MB)보다 훨씬 낮게 잡는다.
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 60_000;

/** base64 문자열의 실제 바이트 수(패딩 무시한 근사 — 상한 판정용으로 충분하다). */
export function base64ByteLength(base64: string): number {
  return Math.ceil((base64.length * 3) / 4);
}

/** HTTP 상태를 사용자에게 의미 있는 코드로 옮긴다. 본문 원문은 흘리지 않는다. */
export function checkErrorForStatus(status: number): CheckError {
  if (status === 401 || status === 403) return new CheckError("auth_failed", `HTTP ${status}`);
  if (status === 429) return new CheckError("rate_limited", "HTTP 429");
  if (status === 408 || status === 504) return new CheckError("upstream_timeout", `HTTP ${status}`);
  return new CheckError("upstream_error", `HTTP ${status}`);
}
