import { describe, expect, it } from "vitest";

import {
  FOCUS_NUDGE_MESSAGES,
  FOCUS_NUDGE_RULES,
  getFocusNudgeMessage,
  getFocusSummaryAfterCheck,
  initFocusNudgeState,
  markFocusNudgeShown,
  shouldShowFocusNudge,
  verdictToFocusCheck,
  type FocusSessionSummary
} from "./m3Focus";

describe("focus nudge — trigger + cooldown (목표1)", () => {
  it("shows a nudge only when drowsy is confirmed", () => {
    const state = initFocusNudgeState();
    expect(shouldShowFocusNudge("drowsy", state, 1_000)).toBe(true);
    // suspect/그 외는 넛지 금지.
    expect(shouldShowFocusNudge("suspect", state, 1_000)).toBe(false);
    expect(shouldShowFocusNudge("focused", state, 1_000)).toBe(false);
    expect(shouldShowFocusNudge("measuring_difficult", state, 1_000)).toBe(false);
    expect(shouldShowFocusNudge("calibrating", state, 1_000)).toBe(false);
  });

  it("does not re-show during cooldown, shows again after it passes", () => {
    let state = initFocusNudgeState();
    const t0 = 10_000;
    expect(shouldShowFocusNudge("drowsy", state, t0)).toBe(true);
    state = markFocusNudgeShown(state, t0);

    // 쿨다운 중(절반 경과) → 재알림 안 뜸.
    expect(shouldShowFocusNudge("drowsy", state, t0 + FOCUS_NUDGE_RULES.cooldownMs / 2)).toBe(false);
    // 쿨다운 직전 → 여전히 안 뜸.
    expect(shouldShowFocusNudge("drowsy", state, t0 + FOCUS_NUDGE_RULES.cooldownMs - 1)).toBe(false);
    // 쿨다운 경과 → 다시 뜸.
    expect(shouldShowFocusNudge("drowsy", state, t0 + FOCUS_NUDGE_RULES.cooldownMs)).toBe(true);
  });

  it("rotates nudge messages and keeps them within the set", () => {
    let state = initFocusNudgeState();
    const first = getFocusNudgeMessage(state);
    expect(FOCUS_NUDGE_MESSAGES).toContain(first);
    state = markFocusNudgeShown(state, 1_000);
    const second = getFocusNudgeMessage(state);
    expect(FOCUS_NUDGE_MESSAGES).toContain(second);
    expect(second).not.toBe(first);
  });
});

describe("focus check aggregation — recording (목표2)", () => {
  it("records a drowsy check only when drowsy is confirmed", () => {
    expect(verdictToFocusCheck("drowsy")).toEqual({ record: true, drowsy: true });
    expect(verdictToFocusCheck("focused")).toEqual({ record: true, drowsy: false });
    expect(verdictToFocusCheck("suspect")).toEqual({ record: true, drowsy: false });
  });

  it("does not record while calibrating or when measurement is difficult", () => {
    expect(verdictToFocusCheck("calibrating")).toEqual({ record: false, drowsy: false });
    expect(verdictToFocusCheck("measuring_difficult")).toEqual({ record: false, drowsy: false });
  });

  it("counts one drowsy event per confirmed drowsy check and yields a focus ratio", () => {
    // 리포트가 나중에 읽을 형태: check_total, drowsy_count, focus_score(집중률 %).
    let summary: FocusSessionSummary = { checkTotal: 0, drowsyCount: 0, focusScore: null };
    const verdicts = ["focused", "focused", "drowsy", "focused", "drowsy"] as const;
    for (const verdict of verdicts) {
      const decision = verdictToFocusCheck(verdict);
      if (decision.record) summary = getFocusSummaryAfterCheck(summary, decision.drowsy);
    }
    expect(summary.checkTotal).toBe(5);
    expect(summary.drowsyCount).toBe(2); // 졸음 확정 2회만 집계
    expect(summary.focusScore).toBe(60); // (5-2)/5 = 60%
  });

  it("skips non-measurable verdicts so they do not distort the focus ratio", () => {
    let summary: FocusSessionSummary = { checkTotal: 0, drowsyCount: 0, focusScore: null };
    const verdicts = ["measuring_difficult", "focused", "calibrating", "drowsy"] as const;
    for (const verdict of verdicts) {
      const decision = verdictToFocusCheck(verdict);
      if (decision.record) summary = getFocusSummaryAfterCheck(summary, decision.drowsy);
    }
    // 측정어려움·기준학습은 기록 안 됨 → 표본 2개만.
    expect(summary.checkTotal).toBe(2);
    expect(summary.drowsyCount).toBe(1);
    expect(summary.focusScore).toBe(50);
  });
});
