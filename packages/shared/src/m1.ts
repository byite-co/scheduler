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

export function requiresGuardianConsent(
  birthDate: string,
  asOf: string | Date = new Date()
): boolean {
  const bornAt = parseDateOnly(birthDate);
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

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error("Date must use YYYY-MM-DD format");
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcYears(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}
