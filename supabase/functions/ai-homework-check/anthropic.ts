// Claude 비전으로 "숙제를 다 했는지" 확인한다.
//
// 🚨 이 기능은 **채점이 아니다.** 정답 여부는 판단하지 않는다. 제품 원칙 §3-2:
//    "AI는 감독관이 아니라 조수다." 최종 판단은 과외쌤(또는 학생 본인)이 한다.
//    확신할 수 없으면 단정하지 말고 ambiguous 로 넘겨 사람이 보게 한다.

export type Verdict = "pass" | "insufficient" | "ambiguous";

export type VisionResult = {
  verdict: Verdict;
  confidence: number;
  reason: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsdMicros: number;
};

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
// Claude Haiku 4.5 기준 100만 토큰당 입력 $1 / 출력 $5 (Sonnet 의 1/3).
const INPUT_MICROS_PER_MTOK = 1_000_000;
const OUTPUT_MICROS_PER_MTOK = 5_000_000;

export function estimateCostUsdMicros(inputTokens: number, outputTokens: number): number {
  const input = Math.round((inputTokens * INPUT_MICROS_PER_MTOK) / 1_000_000);
  const output = Math.round((outputTokens * OUTPUT_MICROS_PER_MTOK) / 1_000_000);
  return input + output;
}

// 비전 입력 상한. 앱이 긴 변 1568px/JPEG q0.8 로 줄여 보내지만, 우회 업로드가 있을 수 있어
// 여기서도 막는다. Anthropic 요청 전체 크기 제한(약 32MB)보다 훨씬 낮게 잡는다.
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = [
  "당신은 한국 중고등학생의 숙제 '수행 여부'를 확인하는 조수입니다.",
  "",
  "## 당신이 하는 일",
  "학생이 제출한 사진을 보고 **지정된 범위를 다 했는지**만 확인합니다.",
  "",
  "## 절대 하지 않는 일",
  "- **정답 여부를 판정하지 않습니다.** 답이 맞았는지 틀렸는지는 당신의 일이 아닙니다.",
  "- **확신할 수 없는 것을 단정하지 않습니다.** 애매하면 ambiguous 로 넘겨 선생님이 보게 합니다.",
  "- **사진에서 읽을 수 없는 것을 추측으로 채우지 않습니다.** 안 보이면 '확인 어려움'이라고 씁니다.",
  "",
  "## 확인할 것",
  "1. 사진이 지정된 범위와 맞는가 (페이지 번호·문제 번호가 보이는 경우에만 대조)",
  "2. 범위에서 빠진 것이 있는가 / 제외하라고 한 것을 잘못 제출했는가",
  "3. 빈칸 없이 풀었는가 (풀이가 비어 있거나 문제만 있고 답이 없는 곳)",
  "4. 틀린 문제를 고친 흔적이 있는가 (다른 색 펜, 지운 자리 등) — 있으면 긍정적 신호로만 언급",
  "",
  "## 범위 표기 해석",
  "범위는 자유 텍스트입니다. 예: '쎈 112-118p, 115 제외' / '기출 3, 5-12번' / '영단어 Day 12~14'.",
  "구간(-, ~)과 제외(제외, 빼고)를 해석해서 대조하세요.",
  "**페이지·문제 번호가 사진에서 안 보이면 범위 대조는 불가능합니다.** 억지로 판정하지 말고",
  "reason 에 '페이지 확인 어려움'을 적고, 빈칸 여부 등 확인 가능한 것만 판단하세요.",
  "이때 reason 에 **'페이지 번호가 보이게 다시 찍어 주세요'** 처럼 학생이 할 행동을 반드시 넣으세요.",
  "",
  "## 판정 기준",
  "- pass: 범위를 다 한 것으로 보이고 빈칸이 없다",
  "- insufficient: 빠진 부분이나 빈칸이 분명히 보인다",
  "- ambiguous: 판단이 어렵다 (사진이 흐림·범위 확인 불가·일부만 보임 등)",
  "",
  "## 출력 형식",
  "다른 말 없이 JSON 한 덩어리만 출력합니다:",
  '{"verdict":"pass|insufficient|ambiguous","confidence":0.0~1.0,"reason":"한국어 1~2문장"}',
  "reason 은 학생이 읽습니다. 채점처럼 들리지 않게, 무엇을 확인했고 무엇이 남았는지 담백하게 적으세요.",
  "빠진 것이 있으면 어디가 빠졌는지 구체적으로 알려 주세요."
].join("\n");

type ImagePart = { mediaType: string; base64: string };

/** 응답에서 JSON 덩어리만 골라낸다. 모델이 앞뒤에 말을 붙이거나 코드펜스를 쓸 수 있다. */
function parseVerdictJson(text: string): { verdict: Verdict; confidence: number; reason: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new CheckError("response_malformed", "JSON 을 찾지 못했다");

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new CheckError("response_malformed", "JSON 파싱 실패");
  }

  const record = parsed as Record<string, unknown>;
  const verdict = record.verdict;
  if (verdict !== "pass" && verdict !== "insufficient" && verdict !== "ambiguous") {
    throw new CheckError("response_malformed", `알 수 없는 verdict: ${String(verdict)}`);
  }
  const rawConfidence = typeof record.confidence === "number" ? record.confidence : 0.5;
  const confidence = Math.max(0, Math.min(1, rawConfidence));
  const reason =
    typeof record.reason === "string" && record.reason.trim().length > 0
      ? record.reason.trim().slice(0, 500)
      : "확인 결과를 정리하지 못했어요. 선생님이 확인해 주실 거예요.";

  return { verdict, confidence, reason };
}

export async function callAnthropicVision(input: {
  apiKey: string;
  model: string;
  scopeText: string | null;
  images: ImagePart[];
}): Promise<VisionResult> {
  if (input.images.length === 0) throw new CheckError("photos_missing", "사진이 없다");

  const totalBytes = input.images.reduce((sum, image) => sum + Math.ceil((image.base64.length * 3) / 4), 0);
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new CheckError("photo_too_large", `총 ${totalBytes} 바이트`);

  const scope = input.scopeText?.trim();
  const userText = scope
    ? `검사 범위: ${scope}\n\n위 범위를 다 했는지 확인해 주세요.`
    : "검사 범위가 지정되지 않았습니다. 범위 대조는 하지 말고, 빈칸 없이 풀었는지만 확인해 주세요.";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              ...input.images.map((image) => ({
                type: "image",
                source: { type: "base64", media_type: image.mediaType, data: image.base64 }
              })),
              { type: "text", text: userText }
            ]
          }
        ]
      })
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CheckError("upstream_timeout", "Anthropic 응답 시간 초과");
    }
    throw new CheckError("upstream_error", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 본문에 키가 섞일 일은 없지만, 원문을 그대로 흘리지 않고 코드만 남긴다.
    if (response.status === 401 || response.status === 403) throw new CheckError("auth_failed", `HTTP ${response.status}`);
    if (response.status === 429) throw new CheckError("rate_limited", "HTTP 429");
    if (response.status === 408 || response.status === 504) throw new CheckError("upstream_timeout", `HTTP ${response.status}`);
    throw new CheckError("upstream_error", `HTTP ${response.status}`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new CheckError("response_malformed", "응답이 JSON 이 아니다");
  }

  const content = payload.content;
  const text = Array.isArray(content)
    ? content
        .map((part) => (part as Record<string, unknown>)?.text)
        .filter((value): value is string => typeof value === "string")
        .join("\n")
    : "";
  if (!text) throw new CheckError("response_malformed", "텍스트 블록이 없다");

  const usage = (payload.usage ?? {}) as Record<string, unknown>;
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const model = typeof payload.model === "string" ? payload.model : input.model;

  return {
    ...parseVerdictJson(text),
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsdMicros: estimateCostUsdMicros(inputTokens, outputTokens)
  };
}
