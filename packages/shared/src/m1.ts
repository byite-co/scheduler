export type UserRole = "student" | "teacher";

export type ReportShareAccess = {
  kind: "report_share_token";
  shareToken: string;
};

export type M1ConnectionStatus = "pending" | "active" | "rejected";
export type ConnectionStatus = M1ConnectionStatus | "disconnected";

export type ConnectionRequest = {
  id: string;
  teacherId: string;
  studentId: string;
  inviteCode: string;
  requestedBy: string;
  requestedAt: string;
  status: M1ConnectionStatus;
  activatedAt?: string;
  rejectedAt?: string;
};

export type DisclosureScope = {
  shareStudyTime: boolean;
  shareHomeworkPhotos: boolean;
  shareFocusData: boolean;
};

export type StudentSignupState = {
  name: string;
  birthDate: string;
  grade: string;
  termsAccepted: boolean;
  emailVerified: boolean;
  guardianConsentAccepted: boolean;
};

export type TeacherStudentSettings = {
  aiCheckSubjects: string[];
  reportCycle: "weekly" | "biweekly" | "none";
};

export const M1_ROUTE_MANIFEST = {
  student: [
    "/signup",
    "/signup/terms",
    "/signup/profile",
    "/onboarding/connect",
    "/onboarding/connect/status",
    "/onboarding/disclosure",
    "/forgot",
    "/reset"
  ],
  teacher: [
    "/login",
    "/signup",
    "/reset",
    "/onboarding/profile",
    "/onboarding/first-student",
    "/students/invite",
    "/students/requests",
    "/students/requests/accepted",
    "/students/requests/rejected",
    "/students/demo/settings"
  ]
} as const;

export const DEFAULT_DISCLOSURE_SCOPE: DisclosureScope = {
  shareStudyTime: true,
  shareHomeworkPhotos: true,
  shareFocusData: false
};

export const DEFAULT_TEACHER_STUDENT_SETTINGS: TeacherStudentSettings = {
  aiCheckSubjects: [],
  reportCycle: "weekly"
};

export const INVITE_CODE_PATTERN = /^[A-Z0-9]{6,8}$/;

export const M1_CONNECTION_STATUS_SCREENS: Record<
  M1ConnectionStatus,
  {
    route: string;
    label: string;
    heading: string;
    description: string;
    tone: "warning" | "success" | "danger";
  }
> = {
  pending: {
    route: "/students/requests",
    label: "대기",
    heading: "연결 요청 대기",
    description: "학생의 요청이 들어왔고 선생님 확인이 필요합니다.",
    tone: "warning"
  },
  active: {
    route: "/students/requests/accepted",
    label: "연결 완료",
    heading: "연결 활성화",
    description: "학생과 선생님 양쪽에 active 상태가 반영됩니다.",
    tone: "success"
  },
  rejected: {
    route: "/students/requests/rejected",
    label: "거절",
    heading: "연결 거절",
    description: "거절된 요청은 수업 데이터에 접근할 수 없습니다.",
    tone: "danger"
  }
};

export function normalizeInviteCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidInviteCode(code: string): boolean {
  return INVITE_CODE_PATTERN.test(normalizeInviteCode(code));
}

export function formatInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code);
  return normalized.length > 4
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : normalized;
}

// ── 초대 코드 사용 결과 ─────────────────────────────────────────────────────
// request_connection_by_invite 는 사용자 입력 실패를 **예외가 아니라 결과값**으로 돌려준다.
// 예외로 끝내면 시도 기록이 같은 트랜잭션에서 롤백돼 속도 제한을 셀 수 없다
// (측정 근거는 마이그레이션 20260819030000 주석에 있다).
// 그래서 클라이언트는 error 만 보면 안 되고 이 reason 을 읽어야 한다.

export type InviteRedeemSuccessReason = "created" | "reopened" | "existing";
export type InviteRedeemFailureReason = "invalid_format" | "not_found" | "already_used" | "rate_limited";

export type InviteRedeemResult =
  | {
      ok: true;
      reason: InviteRedeemSuccessReason;
      connection: { id: string; status: string } & Record<string, unknown>;
    }
  | { ok: false; reason: InviteRedeemFailureReason; retry_after_seconds?: number };

export function isInviteRedeemSuccess(
  result: InviteRedeemResult
): result is Extract<InviteRedeemResult, { ok: true }> {
  return result.ok === true;
}

/**
 * 초대 코드 사용 결과를 사용자에게 보여 줄 한 줄로 바꾼다.
 *
 * ⚠️ not_found 와 already_used 를 구분해서 알려 준다. 추측하는 쪽에는 "그 코드는 실재한다" 는
 * 정보가 새지만, 오타를 낸 학생과 남이 먼저 쓴 코드를 받은 학생은 해야 할 일이 다르다.
 * 추측 1회의 비용은 시도 제한이 담당한다(10분 10회) — 문구로 감추는 쪽이 아니다.
 */
export function describeInviteRedeemResult(result: InviteRedeemResult): string {
  if (result.ok) {
    return `연결 요청이 ${result.connection.status} 상태로 저장되었습니다.`;
  }

  switch (result.reason) {
    case "invalid_format":
      return "초대 코드는 영문·숫자 6~8자리예요. 다시 확인해 주세요.";
    case "not_found":
      return "그 초대 코드를 찾을 수 없어요. 코드가 만료되었을 수도 있어요.";
    case "already_used":
      return "이미 사용된 초대 코드예요. 선생님께 새 코드를 받아 주세요.";
    case "rate_limited": {
      const minutes = Math.max(1, Math.ceil((result.retry_after_seconds ?? 600) / 60));
      return `코드를 여러 번 잘못 입력했어요. ${minutes}분 뒤에 다시 시도해 주세요.`;
    }
  }
}

export function createConnectionRequest(input: {
  id: string;
  teacherId: string;
  studentId: string;
  inviteCode: string;
  requestedBy: string;
  requestedAt: string;
}): ConnectionRequest {
  const inviteCode = normalizeInviteCode(input.inviteCode);

  if (!isValidInviteCode(inviteCode)) {
    throw new Error("Invite code must be 6 to 8 uppercase letters or numbers");
  }

  if (input.requestedBy !== input.teacherId && input.requestedBy !== input.studentId) {
    throw new Error("Connection request must be created by a connection participant");
  }

  return {
    ...input,
    inviteCode,
    status: "pending"
  };
}

export function resolveConnectionRequest(input: {
  request: ConnectionRequest;
  actorId: string;
  decision: "accept" | "reject";
  decidedAt: string;
}): ConnectionRequest {
  const { request, actorId, decision, decidedAt } = input;

  if (request.status !== "pending") {
    throw new Error("Only pending connection requests can be resolved");
  }

  if (actorId !== request.teacherId) {
    throw new Error("Only the teacher can accept or reject a connection request");
  }

  if (decision === "accept") {
    return {
      ...request,
      status: "active",
      activatedAt: decidedAt,
      rejectedAt: undefined
    };
  }

  return {
    ...request,
    status: "rejected",
    activatedAt: undefined,
    rejectedAt: decidedAt
  };
}

export function canRequestConnectionAgain(status: ConnectionStatus | undefined): boolean {
  return status === undefined || status === "rejected" || status === "disconnected";
}

export function updateDisclosureScope(input: {
  current: DisclosureScope;
  patch: Partial<DisclosureScope>;
  actorRole: UserRole;
}): DisclosureScope {
  if (input.actorRole !== "student") {
    throw new Error("Only students can update disclosure settings");
  }

  return {
    ...input.current,
    ...input.patch
  };
}

export function getTeacherVisibleStudentSections(scope: DisclosureScope): string[] {
  return [
    scope.shareStudyTime ? "study_time" : undefined,
    scope.shareHomeworkPhotos ? "homework_photos" : undefined,
    scope.shareFocusData ? "focus_data" : undefined
  ].filter((section): section is string => Boolean(section));
}

export function isValidBirthDate(birthDate: string): boolean {
  return tryParseDateOnly(birthDate) !== null;
}

export function requiresGuardianConsent(
  birthDate: string,
  asOf: string | Date = new Date()
): boolean {
  const bornAt = tryParseDateOnly(birthDate);
  // 생년월일이 아직 비어있거나 형식이 맞지 않으면 나이 판단을 보류한다(동의 미요구).
  // 유효한 날짜가 입력되면 그때 만 14세 미만 여부를 정상 평가한다.
  if (!bornAt) {
    return false;
  }

  const current = typeof asOf === "string" ? parseDateOnly(asOf) : asOf;
  const fourteenthBirthday = addUtcYears(bornAt, 14);

  return current.getTime() < fourteenthBirthday.getTime();
}

export function getMissingStudentSignupSteps(
  state: StudentSignupState,
  asOf: string | Date = new Date()
): string[] {
  const missing = [
    state.emailVerified ? undefined : "email_verification",
    state.termsAccepted ? undefined : "terms",
    state.name.trim() ? undefined : "profile_name",
    state.grade.trim() ? undefined : "profile_grade",
    isValidBirthDate(state.birthDate) ? undefined : "profile_birth_date",
    requiresGuardianConsent(state.birthDate, asOf) && !state.guardianConsentAccepted
      ? "guardian_consent"
      : undefined
  ];

  return missing.filter((step): step is string => Boolean(step));
}

export function canCompleteStudentSignup(
  state: StudentSignupState,
  asOf: string | Date = new Date()
): boolean {
  return getMissingStudentSignupSteps(state, asOf).length === 0;
}

function tryParseDateOnly(value: string): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const [year, month, day] = trimmed.split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // 존재하지 않는 날짜(예: 2013-02-30)는 무효로 처리.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseDateOnly(value: string): Date {
  const parsed = tryParseDateOnly(value);
  if (!parsed) {
    throw new Error("Date must use YYYY-MM-DD format");
  }

  return parsed;
}

function addUtcYears(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

// ── 대기 중인 연결 요청의 학생 표시 ────────────────────────────────────────────
//
// profiles RLS(profiles_connected_read)는 active 연결만 허용한다. 그래서 pending 요청에서는
// 학생 프로필을 읽을 수 없고, 화면이 UUID 앞자리를 보여 줬다 — 과외쌤이 누가 요청했는지
// 모르는 채로 수락/거절을 눌러야 했다.
//
// pending_connection_requests() RPC 가 이 세 필드만 돌려준다. 수락/거절 결정에 필요한
// 최소한이고, 생년월일·목표대학·사진은 넘어오지 않는다.
export type PendingConnectionRequest = {
  connection_id: string;
  student_name: string | null;
  student_grade: string | null;
  requested_at: string | null;
};

/**
 * 요청 행에 찍을 이름표. 동명이인이 있을 수 있어 학년이 있으면 함께 보여 준다.
 * 이름이 비어 있으면(프로필 미작성) 빈 문자열 대신 그 사실을 말한다 — 빈 칸은 오류처럼 보인다.
 */
export function formatPendingRequestLabel(request: {
  student_name?: string | null;
  student_grade?: string | null;
}): string {
  const name = (request.student_name ?? "").trim();
  const grade = (request.student_grade ?? "").trim();
  if (!name) return grade ? `이름 미입력 · ${grade}` : "이름 미입력";
  return grade ? `${name} · ${grade}` : name;
}

/**
 * RPC 응답을 connection_id 로 찾을 수 있게 만든다.
 * RPC 가 실패하거나(네트워크·권한) 행이 없으면 빈 Map — 호출부는 이름 없이도 그려야 한다.
 */
export function indexPendingRequests(
  rows: PendingConnectionRequest[] | null | undefined
): Map<string, PendingConnectionRequest> {
  return new Map((rows ?? []).map((row) => [row.connection_id, row]));
}

/**
 * 학생 앱에서 연결 상대(과외쌤)를 부르는 이름표.
 *
 * profiles RLS 는 양방향 모두 active 만 허용한다. 그래서 **수락 전에는 학생도 쌤 이름을
 * 읽을 수 없다.** 그 자리에 연결 ID 앞자리를 찍으면 학생에게는 아무 의미 없는 문자열이다.
 * 대신 학생이 직접 입력한 초대 코드를 보여 주고, 코드조차 없으면 왜 이름이 없는지 말한다.
 *
 * (과외쌤 쪽과 달리 여기엔 전용 RPC 를 두지 않았다. 학생은 쌤이 준 코드를 입력해서 요청하므로
 *  상대가 누구인지 이미 안다 — 모르는 상대의 요청을 받는 과외쌤 쪽과는 상황이 다르다.)
 */
export function formatConnectionTeacherLabel(input: {
  teacherName?: string | null;
  inviteCode?: string | null;
}): string {
  const name = (input.teacherName ?? "").trim();
  if (name) return `${name} 선생님`;
  const code = (input.inviteCode ?? "").trim();
  if (code) return formatInviteCode(code);
  return "수락 후 이름이 보여요";
}
