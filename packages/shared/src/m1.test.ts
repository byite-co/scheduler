import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISCLOSURE_SCOPE,
  M1_CONNECTION_STATUS_SCREENS,
  canRequestConnectionAgain,
  canCompleteStudentSignup,
  createConnectionRequest,
  formatInviteCode,
  getMissingStudentSignupSteps,
  getTeacherVisibleStudentSections,
  isValidBirthDate,
  isValidInviteCode,
  requiresGuardianConsent,
  resolveConnectionRequest,
  updateDisclosureScope
} from "./m1";

describe("M1 invite and connection handshake", () => {
  const pendingRequest = createConnectionRequest({
    id: "conn-1",
    teacherId: "teacher-1",
    studentId: "student-1",
    inviteCode: " ssam-24 ",
    requestedBy: "student-1",
    requestedAt: "2026-06-22T00:00:00.000Z"
  });

  it("normalizes invite codes and accepts 6 to 8 alphanumeric characters", () => {
    expect(formatInviteCode(" ssam-24 ")).toBe("SSAM-24");
    expect(isValidInviteCode("ssam-24")).toBe(true);
    expect(isValidInviteCode("short")).toBe(false);
  });

  it("creates pending requests before teacher approval", () => {
    expect(pendingRequest).toMatchObject({
      inviteCode: "SSAM24",
      status: "pending"
    });
  });

  it("moves both sides to active when the teacher accepts", () => {
    expect(
      resolveConnectionRequest({
        request: pendingRequest,
        actorId: "teacher-1",
        decision: "accept",
        decidedAt: "2026-06-22T01:00:00.000Z"
      })
    ).toMatchObject({
      status: "active",
      activatedAt: "2026-06-22T01:00:00.000Z"
    });
  });

  it("keeps rejected requests out of active student data", () => {
    expect(
      resolveConnectionRequest({
        request: pendingRequest,
        actorId: "teacher-1",
        decision: "reject",
        decidedAt: "2026-06-22T01:00:00.000Z"
      })
    ).toMatchObject({
      status: "rejected",
      rejectedAt: "2026-06-22T01:00:00.000Z"
    });
  });

  it("uses one route per M1 connection status branch", () => {
    expect(Object.keys(M1_CONNECTION_STATUS_SCREENS)).toEqual([
      "pending",
      "active",
      "rejected"
    ]);
    expect(new Set(Object.values(M1_CONNECTION_STATUS_SCREENS).map((s) => s.route)).size).toBe(3);
  });

  it("allows a rejected or disconnected student to request again with a code", () => {
    expect(canRequestConnectionAgain(undefined)).toBe(true);
    expect(canRequestConnectionAgain("rejected")).toBe(true);
    expect(canRequestConnectionAgain("disconnected")).toBe(true);
    expect(canRequestConnectionAgain("pending")).toBe(false);
    expect(canRequestConnectionAgain("active")).toBe(false);
  });
});

describe("M1 disclosure and guardian consent", () => {
  it("lets only students update disclosure and filters teacher-visible sections", () => {
    const hiddenPhotos = updateDisclosureScope({
      current: DEFAULT_DISCLOSURE_SCOPE,
      patch: { shareHomeworkPhotos: false, shareFocusData: false },
      actorRole: "student"
    });

    expect(getTeacherVisibleStudentSections(hiddenPhotos)).toEqual(["study_time"]);
    expect(() =>
      updateDisclosureScope({
        current: hiddenPhotos,
        patch: { shareFocusData: true },
        actorRole: "teacher"
      })
    ).toThrow(/Only students/);
  });

  it("forces guardian consent for students under 14", () => {
    const underFourteenState = {
      name: "김학생",
      birthDate: "2013-06-23",
      grade: "중1",
      termsAccepted: true,
      emailVerified: true,
      guardianConsentAccepted: false
    };

    expect(requiresGuardianConsent(underFourteenState.birthDate, "2026-06-22")).toBe(true);
    expect(getMissingStudentSignupSteps(underFourteenState, "2026-06-22")).toEqual([
      "guardian_consent"
    ]);
    expect(canCompleteStudentSignup(underFourteenState, "2026-06-22")).toBe(false);
    expect(
      canCompleteStudentSignup(
        { ...underFourteenState, guardianConsentAccepted: true },
        "2026-06-22"
      )
    ).toBe(true);
  });

  it("treats an empty or malformed birth date as not-yet-entered instead of throwing", () => {
    expect(() => requiresGuardianConsent("", "2026-06-22")).not.toThrow();
    expect(requiresGuardianConsent("", "2026-06-22")).toBe(false);
    expect(requiresGuardianConsent("not-a-date", "2026-06-22")).toBe(false);
    expect(requiresGuardianConsent("2013-13-40", "2026-06-22")).toBe(false);
    expect(requiresGuardianConsent("2013-02-30", "2026-06-22")).toBe(false);

    expect(isValidBirthDate("")).toBe(false);
    expect(isValidBirthDate("2013-2-3")).toBe(false);
    expect(isValidBirthDate("2013-06-23")).toBe(true);
  });

  it("flags a missing/invalid birth date as a signup step without crashing, then re-evaluates once entered", () => {
    const incomplete = {
      name: "김학생",
      birthDate: "",
      grade: "중1",
      termsAccepted: true,
      emailVerified: true,
      guardianConsentAccepted: false
    };

    const missing = getMissingStudentSignupSteps(incomplete, "2026-06-22");
    expect(missing).toContain("profile_birth_date");
    expect(missing).not.toContain("guardian_consent");
    expect(canCompleteStudentSignup(incomplete, "2026-06-22")).toBe(false);

    // 유효한 만 14세 미만 생년월일을 입력하면 보호자 동의가 다시 요구된다.
    const withBirth = { ...incomplete, birthDate: "2013-06-23" };
    const reEvaluated = getMissingStudentSignupSteps(withBirth, "2026-06-22");
    expect(reEvaluated).not.toContain("profile_birth_date");
    expect(reEvaluated).toContain("guardian_consent");
    expect(
      canCompleteStudentSignup({ ...withBirth, guardianConsentAccepted: true }, "2026-06-22")
    ).toBe(true);
  });
});
