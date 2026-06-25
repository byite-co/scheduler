import { describe, expect, it } from "vitest";

import {
  FOCUS_DROWSINESS_RULES,
  getEyeOpennessFromSignals,
  getFocusDrowsinessLabel,
  initFocusDrowsinessState,
  reduceFocusDrowsiness,
  type FocusDrowsinessRules,
  type FocusDrowsinessSample,
  type FocusDrowsinessState,
  type FocusFaceSignals
} from "./m3Focus";

// 테스트용으로 시간을 압축한 규칙(기준선/지속시간/디바운스를 짧게).
const RULES: FocusDrowsinessRules = {
  ...FOCUS_DROWSINESS_RULES,
  calibrationMs: 300,
  minCalibrationSamples: 3,
  sampleIntervalMs: 100,
  blinkIgnoreMs: 200,
  eyesClosedMs: 500,
  headDownSustainMs: 500,
  debounceSamples: 2
};

function signals(opts: {
  face?: boolean;
  blink?: number;
  pitch?: number;
  jaw?: number;
}): FocusFaceSignals {
  return {
    facePresent: opts.face ?? true,
    leftEyeBlinkScore: opts.blink ?? 0,
    rightEyeBlinkScore: opts.blink ?? 0,
    pitchDeg: opts.pitch ?? 0,
    yawDeg: 0,
    rollDeg: 0,
    jawOpenScore: opts.jaw ?? 0
  };
}

// atMs를 100ms 간격으로 자동 부여하며 시퀀스를 흘려보낸다.
function run(
  samples: Array<Omit<FocusDrowsinessSample, "atMs">>,
  startState?: FocusDrowsinessState,
  startMs = 0
): FocusDrowsinessState {
  let state = startState ?? initFocusDrowsinessState();
  samples.forEach((sample, index) => {
    state = reduceFocusDrowsiness(state, { ...sample, atMs: startMs + index * 100 }, RULES);
  });
  return state;
}

// 평소(눈 뜸) 상태로 기준선을 잡고 그 다음 시각/상태를 반환.
function calibrated(): { state: FocusDrowsinessState; nextMs: number } {
  const state = run(Array.from({ length: 5 }, () => ({ signals: signals({ blink: 0 }) })));
  return { state, nextMs: 500 };
}

describe("focus drowsiness — eye openness helper", () => {
  it("derives openness from blink scores (1 - blink)", () => {
    expect(getEyeOpennessFromSignals(signals({ blink: 0 }))).toBe(1);
    expect(getEyeOpennessFromSignals(signals({ blink: 0.9 }))).toBeCloseTo(0.1, 5);
    expect(
      getEyeOpennessFromSignals({ ...signals({}), leftEyeBlinkScore: null, rightEyeBlinkScore: null })
    ).toBeNull();
  });
});

describe("focus drowsiness — calibration (rule 3)", () => {
  it("reports calibrating until baseline is learned", () => {
    const early = run([{ signals: signals({ blink: 0 }) }, { signals: signals({ blink: 0 }) }]);
    expect(early.verdict).toBe("calibrating");
    expect(early.baselineEyeOpen).toBeNull();
  });

  it("learns a personal baseline after the calibration window", () => {
    const { state } = calibrated();
    expect(state.baselineEyeOpen).not.toBeNull();
    expect(state.verdict).toBe("focused");
  });
});

describe("focus drowsiness — blink vs sustained closure (rules 1, 5)", () => {
  it("ignores a normal short blink (stays focused)", () => {
    const { state, nextMs } = calibrated();
    // 한 프레임만 감았다가 바로 뜸 = 정상 깜빡임.
    const after = run(
      [{ signals: signals({ blink: 0.9 }) }, { signals: signals({ blink: 0 }) }, { signals: signals({ blink: 0 }) }],
      state,
      nextMs
    );
    expect(after.verdict).toBe("focused");
  });

  it("flags sustained eye closure (>= eyesClosedMs) as drowsy/suspect", () => {
    const { state, nextMs } = calibrated();
    // 0.5s 이상 연속 감김.
    const closedSeq = Array.from({ length: 8 }, () => ({ signals: signals({ blink: 0.95 }) }));
    const after = run(closedSeq, state, nextMs);
    expect(["suspect", "drowsy"]).toContain(after.verdict);
    expect(after.score).toBeGreaterThanOrEqual(RULES.suspectScore);
    expect(after.reasons.join(" ")).toContain("눈");
  });

  it("does not flip on a single drowsy frame (debounce, rule 5)", () => {
    const { state, nextMs } = calibrated();
    // 감김이 디바운스(2) 미만으로 1프레임만 길게 → 아직 전환 안 됨.
    const one = reduceFocusDrowsiness(state, { atMs: nextMs, signals: signals({ blink: 0.95 }) }, RULES);
    expect(one.verdict).toBe("focused");
  });
});

describe("focus drowsiness — multi-signal fusion (rule 2)", () => {
  it("combines sustained closure + head down into drowsy", () => {
    const { state, nextMs } = calibrated();
    const seq = Array.from({ length: 10 }, () => ({ signals: signals({ blink: 0.95, pitch: 30 }) }));
    const after = run(seq, state, nextMs);
    expect(after.verdict).toBe("drowsy");
    expect(after.score).toBeGreaterThanOrEqual(RULES.drowsyScore);
  });

  it("uses yawn (jawOpen) as an auxiliary signal", () => {
    const { state, nextMs } = calibrated();
    // 길게 감김(0.25 기여) + 하품(0.2) → 의심 경계로 끌어올림.
    const seq = Array.from({ length: 4 }, () => ({ signals: signals({ blink: 0.95, jaw: 0.8 }) }));
    const after = run(seq, state, nextMs);
    expect(after.reasons.join(" ")).toContain("하품");
  });
});

describe("focus drowsiness — environment (rule 4)", () => {
  it("reports measuring_difficult when no face is present", () => {
    const { state, nextMs } = calibrated();
    const after = run(
      [{ signals: signals({ face: false }) }, { signals: signals({ face: false }) }],
      state,
      nextMs
    );
    expect(after.verdict).toBe("measuring_difficult");
    expect(after.score).toBe(0);
  });

  it("reports measuring_difficult when too dark (does not call it drowsy)", () => {
    const { state, nextMs } = calibrated();
    const after = run(
      [
        { signals: signals({ blink: 0.95 }), brightness: 0.05 },
        { signals: signals({ blink: 0.95 }), brightness: 0.05 }
      ],
      state,
      nextMs
    );
    expect(after.verdict).toBe("measuring_difficult");
  });
});

describe("focus drowsiness — adaptive cadence (rule 5 structure) + labels", () => {
  it("recommends a shorter interval once suspect/drowsy", () => {
    const { state, nextMs } = calibrated();
    const seq = Array.from({ length: 10 }, () => ({ signals: signals({ blink: 0.95, pitch: 30 }) }));
    const after = run(seq, state, nextMs);
    expect(after.recommendedIntervalMs).toBe(RULES.intervalSuspectMs);
  });

  it("maps verdicts to Korean labels", () => {
    expect(getFocusDrowsinessLabel("focused")).toBe("집중 중");
    expect(getFocusDrowsinessLabel("suspect")).toBe("졸음 의심");
    expect(getFocusDrowsinessLabel("drowsy")).toBe("졸음");
    expect(getFocusDrowsinessLabel("measuring_difficult")).toBe("측정 어려움");
  });
});
