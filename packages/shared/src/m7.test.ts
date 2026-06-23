import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETE_CONFIRM_KEYWORD,
  getNotificationRoute,
  getPushPrimingState,
  getSystemGateState,
  unreadCount,
  validateDeleteConfirmation,
  type NotificationLike,
  type SystemConfig
} from "./m7";

const baseConfig: SystemConfig = { latest_build: 10, min_supported_build: 5, maintenance: false, maintenance_message: null };

describe("M7 system gate (force update > maintenance > ok)", () => {
  it("forces update below the minimum supported build", () => {
    expect(getSystemGateState(4, baseConfig).gate).toBe("force_update");
  });
  it("shows maintenance when flagged and build is supported", () => {
    expect(getSystemGateState(7, { ...baseConfig, maintenance: true, maintenance_message: "점검 중" })).toMatchObject({
      gate: "maintenance",
      message: "점검 중"
    });
  });
  it("ok but flags an available update", () => {
    expect(getSystemGateState(7, baseConfig)).toMatchObject({ gate: "ok", updateAvailable: true });
    expect(getSystemGateState(10, baseConfig)).toMatchObject({ gate: "ok", updateAvailable: false });
  });
});

describe("M7 push priming (denial never blocks the app)", () => {
  it("primes when undetermined, marks blocked when denied, done when granted", () => {
    expect(getPushPrimingState("undetermined").showPriming).toBe(true);
    expect(getPushPrimingState("denied")).toMatchObject({ blocked: true, granted: false });
    expect(getPushPrimingState("granted")).toMatchObject({ granted: true, showPriming: false });
  });
});

describe("M7 notification routing + unread", () => {
  it("counts unread", () => {
    expect(unreadCount([{ read: false }, { read: true }, { read: false }])).toBe(2);
  });
  it("prefers payload.route then falls back per type", () => {
    const withRoute: NotificationLike = { id: "1", type: "system", read: false, payload: { route: "/notifications" } };
    expect(getNotificationRoute(withRoute)).toBe("/notifications");
    const homework: NotificationLike = { id: "2", type: "homework", read: false, payload: { todoId: "abc" } };
    expect(getNotificationRoute(homework)).toBe("/homework/abc");
    const report: NotificationLike = { id: "3", type: "report", read: false, payload: null };
    expect(getNotificationRoute(report)).toBe("/report");
    const billing: NotificationLike = { id: "4", type: "billing", read: false, payload: null };
    expect(getNotificationRoute(billing)).toBe("/settings/subscription");
  });
});

describe("M7 account deletion confirmation", () => {
  it("requires the exact confirm keyword", () => {
    expect(validateDeleteConfirmation(` ${ACCOUNT_DELETE_CONFIRM_KEYWORD} `)).toBe(true);
    expect(validateDeleteConfirmation("지움")).toBe(false);
    expect(validateDeleteConfirmation("")).toBe(false);
  });
});
