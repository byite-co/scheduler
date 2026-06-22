import { describe, expect, it } from "vitest";

import {
  getDrowsinessFromSignals,
  getFocusSummaryAfterCheck,
  getFocusSummaryFromChecks,
  getSignalsFromMediaPipeFaceLandmarker
} from "./m3Focus";

describe("M3 focus drowsiness signals", () => {
  it("flags closed eyes from MediaPipe Face Landmarker blendshape scores", () => {
    const signals = getSignalsFromMediaPipeFaceLandmarker({
      faceLandmarks: [[{ x: 0.5, y: 0.5 }]],
      faceBlendshapes: [
        {
          categories: [
            { categoryName: "eyeBlinkLeft", score: 0.74 },
            { categoryName: "eyeBlinkRight", score: 0.72 }
          ]
        }
      ]
    });

    expect(getDrowsinessFromSignals(signals)).toMatchObject({
      drowsy: true,
      reason: "eyes_closed"
    });
  });

  it("flags head angle based drowsiness when eyes are open but the head is down", () => {
    expect(
      getDrowsinessFromSignals({
        facePresent: true,
        leftEyeBlinkScore: 0.1,
        rightEyeBlinkScore: 0.12,
        pitchDeg: 27,
        yawDeg: 4,
        rollDeg: 1
      })
    ).toMatchObject({
      drowsy: true,
      reason: "head_down"
    });
  });

  it("does not call no-face frames drowsy and lets the UI keep a gentle tone", () => {
    expect(
      getDrowsinessFromSignals({
        facePresent: false,
        leftEyeBlinkScore: null,
        rightEyeBlinkScore: null,
        pitchDeg: null,
        yawDeg: null,
        rollDeg: null
      })
    ).toEqual({
      drowsy: false,
      reason: "no_face",
      confidence: 0.2
    });
  });

  it("aggregates boolean checks into drowsy count and focus score", () => {
    expect(getFocusSummaryAfterCheck({ checkTotal: 5, drowsyCount: 1, focusScore: 80 }, true)).toEqual({
      checkTotal: 6,
      drowsyCount: 2,
      focusScore: 67
    });

    expect(getFocusSummaryFromChecks([{ drowsy: false }, { drowsy: true }, { drowsy: false }])).toEqual({
      checkTotal: 3,
      drowsyCount: 1,
      focusScore: 67
    });
  });
});
