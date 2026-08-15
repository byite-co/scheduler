// M7 — 알림 · 계정 · 시스템 상태의 순수 로직.

export type NotifType =
  | "reminder"
  | "homework"
  | "resubmit"
  | "check_done"
  | "report"
  | "connection"
  | "billing"
  | "cheer"
  | "system";

export const NOTIF_TYPE_LABELS: Record<NotifType, string> = {
  reminder: "리마인드",
  homework: "숙제",
  resubmit: "다시 제출",
  check_done: "검사 완료",
  report: "리포트",
  connection: "연결",
  billing: "결제",
  cheer: "응원",
  system: "공지"
};

/**
 * 앱 내 알림이 실제로 생기는 이벤트 목록 (20260809000000).
 *
 * 알림은 **DB 트리거**가 만든다 — 알림이 필요한 이벤트 대부분이 클라이언트가 테이블에
 * 직접 쓰는 경로라, RPC 로 바꾸면 호출부를 하나라도 빠뜨렸을 때 그 경로만 조용히 알림이
 * 없어진다. 트리거는 모든 쓰기 경로를 덮는다.
 *
 * 이 표는 **문서이자 회귀 방어**다. m7.schema.test.ts 가 여기 적힌 제목이 마이그레이션에
 * 실제로 들어 있는지 대조한다 — 한쪽만 고치면 CI 가 잡는다.
 *
 * ⚠️ 푸시 알림(앱 밖)은 여기 없다. push_tokens 는 아직 아무도 쓰지 않는다.
 * ⚠️ AI 검사 완료 알림도 없다. 판정 노출이 AI_CHECK_RESULTS_ENABLED 로 막혀 있어
 *    지금 보내면 "볼 수 없는 결과"를 알리게 된다.
 */
export const NOTIFICATION_EVENTS = [
  { event: "homework_assigned", type: "homework", to: "student", title: "새 숙제가 등록됐어요" },
  { event: "homework_submitted", type: "homework", to: "teacher", title: "학생이 숙제를 제출했어요" },
  { event: "homework_rejected", type: "resubmit", to: "student", title: "숙제를 다시 제출해 주세요" },
  { event: "homework_confirmed", type: "check_done", to: "student", title: "숙제 확인이 끝났어요" },
  { event: "connection_requested", type: "connection", to: "counterpart", title: "새 연동 요청이 왔어요" },
  { event: "connection_activated", type: "connection", to: "student", title: "선생님과 연동됐어요" },
  { event: "connection_rejected", type: "connection", to: "student", title: "연동 요청이 거절됐어요" },
  { event: "report_sent", type: "report", to: "student", title: "새 리포트가 도착했어요" }
] as const satisfies ReadonlyArray<{
  event: string;
  type: NotifType;
  to: "student" | "teacher" | "counterpart";
  title: string;
}>;

export type NotificationLike = {
  id: string;
  type: NotifType;
  read: boolean;
  payload: { route?: string; todoId?: string; reportToken?: string } | null;
};

export function unreadCount(notifications: Array<{ read: boolean }>): number {
  return notifications.reduce((total, n) => total + (n.read ? 0 : 1), 0);
}

// 알림 → 딥링크 경로. payload.route가 있으면 우선, 없으면 type별 기본 경로.
export function getNotificationRoute(notification: NotificationLike): string {
  if (notification.payload?.route) return notification.payload.route;
  const todoId = notification.payload?.todoId;
  switch (notification.type) {
    case "homework":
    case "resubmit":
    case "check_done":
      return todoId ? `/homework/${todoId}` : "/(tabs)/today";
    case "report":
      return "/report";
    case "connection":
      return "/onboarding/connect/status";
    case "billing":
      return "/settings/subscription";
    case "reminder":
    case "cheer":
      return "/(tabs)/today";
    case "system":
    default:
      return "/notifications";
  }
}

/**
 * 회원 탈퇴 실패 안내. account-delete Edge Function 이 돌려주는 오류를 사용자 문구로 옮긴다.
 *
 * 원문(Supabase FunctionsError)에는 스택·내부 메시지가 섞여 있어 그대로 보여주면
 * 사용자가 무엇을 해야 할지 알 수 없다. **기존 export 는 건드리지 않고 새로 추가한 것이다.**
 */
export function getAccountDeleteErrorMessage(error: { message?: string } | null | undefined): string {
  const raw = error?.message ?? "";
  if (/unauthenticated|missing_authorization|401/i.test(raw)) {
    return "로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.";
  }
  if (/network|fetch|timeout/i.test(raw)) {
    return "연결이 불안정해요. 잠시 후 다시 시도해 주세요.";
  }
  // 사진 정리는 실패해도 계정 삭제는 진행된다(207). 여기 오는 건 계정 삭제 자체의 실패다.
  return "탈퇴 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}

// 푸시 권한 프라이밍 상태 — 거부해도 기능은 막지 않는다.
export type PushPermissionStatus = "undetermined" | "granted" | "denied";

export type PushPrimingState = {
  showPriming: boolean;
  blocked: boolean;
  granted: boolean;
  ctaLabel: string;
  helper: string;
};

export function getPushPrimingState(status: PushPermissionStatus): PushPrimingState {
  if (status === "granted") {
    return { showPriming: false, blocked: false, granted: true, ctaLabel: "알림 켜짐", helper: "중요한 소식을 푸시로 받아요." };
  }
  if (status === "denied") {
    return {
      showPriming: false,
      blocked: true,
      granted: false,
      ctaLabel: "설정에서 알림 켜기",
      helper: "알림을 꺼도 앱은 그대로 쓸 수 있어요."
    };
  }
  return {
    showPriming: true,
    blocked: false,
    granted: false,
    ctaLabel: "알림 받기",
    helper: "숙제·검사 결과를 놓치지 않게 알려드려요. 나중에 꺼도 돼요."
  };
}

// 회원 탈퇴: 다단계 + 본인 확인. 영구 삭제·복구 불가 고지.
export const ACCOUNT_DELETE_CONFIRM_KEYWORD = "삭제";

export const ACCOUNT_DELETE_STEPS = [
  "탈퇴하면 모든 공부 기록·숙제·리포트가 영구 삭제되고 복구할 수 없어요.",
  "연결된 선생님과의 연결, 구독 정보도 함께 정리돼요.",
  `확인을 위해 '${ACCOUNT_DELETE_CONFIRM_KEYWORD}'를 입력해 주세요.`
] as const;

export function validateDeleteConfirmation(input: string): boolean {
  return input.trim() === ACCOUNT_DELETE_CONFIRM_KEYWORD;
}

// 시스템 상태 게이트: 강제 업데이트 > 점검 > 정상.
export type SystemConfig = {
  latest_build: number;
  min_supported_build: number;
  maintenance: boolean;
  maintenance_message: string | null;
};

export type SystemGate = "ok" | "force_update" | "maintenance";

export type SystemGateState = {
  gate: SystemGate;
  updateAvailable: boolean;
  message: string | null;
};

export function getSystemGateState(currentBuild: number, config: SystemConfig): SystemGateState {
  if (currentBuild < config.min_supported_build) {
    return { gate: "force_update", updateAvailable: true, message: "계속하려면 최신 버전으로 업데이트해 주세요." };
  }
  if (config.maintenance) {
    return { gate: "maintenance", updateAvailable: currentBuild < config.latest_build, message: config.maintenance_message };
  }
  return { gate: "ok", updateAvailable: currentBuild < config.latest_build, message: null };
}
