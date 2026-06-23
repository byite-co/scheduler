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
