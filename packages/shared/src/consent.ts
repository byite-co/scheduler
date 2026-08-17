// 약관 동의 증적 — 두 앱이 같은 규칙으로 기록하게 하는 단일 출처.
//
// [지금 상태] 문안은 법률 검토 대기다. 그래서 **문서 본문·URL 은 여기 없다.**
//   이 파일이 정하는 것은 "무엇에 동의를 받아야 하는가"와 "그 사실을 어떻게 기록하는가"다.
//
// [버전을 왜 문자열로 두는가] 정식 문안이 확정되면 버전을 올린다. 그러면 기존 사용자의
//   동의는 **옛 버전에 대한 동의**로 남고(그 자체가 사실이다), 새 버전 동의를 다시 받아야
//   한다는 것을 화면이 판단할 수 있다. 버전을 안 남기면 "무엇에 동의했는지" 를 잃는다.

/** 정식 문안 확정 전 임시 버전. 문서가 나오면 올린다 — 옛 동의 행은 그대로 남는다. */
export const CONSENT_DOCUMENT_VERSION = "draft-0";

export const CONSENT_DOCUMENTS = ["terms_of_service", "privacy_policy", "marketing_optional"] as const;
export type ConsentDocument = (typeof CONSENT_DOCUMENTS)[number];

/** 이 두 개는 동의 없이 가입을 진행할 수 없다. 마케팅은 선택이다. */
export const REQUIRED_CONSENT_DOCUMENTS: ConsentDocument[] = ["terms_of_service", "privacy_policy"];

export const CONSENT_DOCUMENT_LABELS: Record<ConsentDocument, string> = {
  terms_of_service: "서비스 이용약관 (필수)",
  privacy_policy: "개인정보 처리방침 (필수)",
  marketing_optional: "마케팅 정보 수신 (선택)"
};

/**
 * 문안이 없는 동안 보여 줄 안내.
 * ⚠️ 여기서 문서 내용을 **요약하지 않는다.** 요약도 약속이고, 확정 전 요약은 거짓이 될 수 있다.
 */
export const CONSENT_PENDING_NOTICE = "약관 전문은 준비 중이에요. 정식 문안이 확정되면 다시 동의를 받아요.";

export type ConsentSelection = Partial<Record<ConsentDocument, boolean>>;

/** 필수 항목이 전부 체크됐는가. 화면의 "계속" 버튼이 이 값으로 잠긴다. */
export function canProceedWithConsent(selection: ConsentSelection): boolean {
  return REQUIRED_CONSENT_DOCUMENTS.every((doc) => selection[doc] === true);
}

export type ConsentRow = {
  user_id: string;
  document: ConsentDocument;
  version: string;
  action: "accepted" | "withdrawn";
  subject: "self";
  method: string;
};

/**
 * 체크 상태를 `consent_records` INSERT 페이로드로 바꾼다.
 *
 * **체크된 것만** 행을 만든다. 선택 항목을 안 눌렀다는 사실을 `accepted=false` 행으로 남기지
 * 않는 이유: 이 표는 append-only 동의 이력이고, "동의하지 않음" 은 행이 없는 것으로 표현된다.
 * (거절을 명시적으로 남겨야 한다면 그건 별도 요구사항이다.)
 *
 * subject 는 'self' 로 고정한다 — 보호자 동의는 보호자 확인 절차가 필요하고, RLS 정책도
 * 클라이언트에게 self 만 허용한다.
 */
export function buildConsentRows(
  userId: string,
  selection: ConsentSelection,
  method: string,
  version: string = CONSENT_DOCUMENT_VERSION
): ConsentRow[] {
  return CONSENT_DOCUMENTS.filter((doc) => selection[doc] === true).map((doc) => ({
    user_id: userId,
    document: doc,
    version,
    action: "accepted",
    subject: "self",
    method
  }));
}

export type ConsentStatusRow = {
  document: string;
  version: string;
  action: string;
};

/**
 * 이미 이번 버전에 동의했는가 — 중복 기록을 막는 판단.
 * append-only 라 같은 동의를 두 번 넣어도 데이터가 깨지지는 않지만, 이력이 지저분해진다.
 */
export function hasCurrentConsent(
  status: ConsentStatusRow[] | null | undefined,
  version: string = CONSENT_DOCUMENT_VERSION
): boolean {
  const rows = status ?? [];
  return REQUIRED_CONSENT_DOCUMENTS.every((doc) =>
    rows.some((row) => row.document === doc && row.version === version && row.action === "accepted")
  );
}
