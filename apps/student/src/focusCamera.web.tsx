import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { colors, radii, spacing, typography } from "@ssamplanner/design-tokens";
import {
  FOCUS_CAMERA_PRIVACY_COPY,
  FOCUS_CAMERA_TIMER_ONLY_COPY,
  getFocusCameraFallbackTitle,
  getSignalsFromMediaPipeFaceLandmarker,
  type FocusDrowsinessResult,
  type FocusFaceSignals
} from "@ssamplanner/shared";
// 타입만 사용한다(런타임은 CDN ESM에서 로드 — Metro가 mediapipe 번들을 변환하지 못함).
import type * as VisionTasks from "@mediapipe/tasks-vision";

export type FocusCheckEvent = FocusDrowsinessResult & {
  checkedAt: string;
};

type FocusCameraProps = {
  active: boolean;
  onFocusCheck?: (check: FocusCheckEvent) => void;
  sessionId?: string;
  style?: StyleProp<ViewStyle>;
};

type PermissionGateProps = {
  style?: StyleProp<ViewStyle>;
};

// 라이브러리(JS/WASM)와 모델 자산만 MediaPipe CDN에서 받아온다 — 카메라 프레임은 절대 전송하지 않는다.
const MEDIAPIPE_VERSION = "0.10.35";
const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// 런타임 dynamic import 경로를 정적 리터럴이 아닌 식으로 만들어 Metro가 번들에 포함(=변환 실패)하지 않게 한다.
// 브라우저 네이티브 import()가 CDN ESM을 그대로 로드한다.
async function loadVisionModule(): Promise<typeof VisionTasks> {
  const url = ["https://cdn.jsdelivr.net/npm", `@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`, "vision_bundle.mjs"].join(
    "/"
  );
  return import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<typeof VisionTasks>;
}

type DetectStatus = "loading" | "denied" | "unsupported" | "error" | "running";

// 얼굴 신호(눈 감김 점수)에서 "눈 뜬 정도"(0~1)를 만든다. 점수가 높을수록 감긴 상태.
function eyeOpenness(signals: FocusFaceSignals): number | null {
  const scores = [signals.leftEyeBlinkScore, signals.rightEyeBlinkScore].filter(
    (value): value is number => typeof value === "number"
  );
  if (!scores.length) return null;
  const avgBlink = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return Math.max(0, Math.min(1, 1 - avgBlink));
}

function formatDeg(value: number | null): string {
  return typeof value === "number" ? `${Math.round(value)}°` : "—";
}

export function FocusCameraPanel({ active, style }: FocusCameraProps) {
  const [status, setStatus] = useState<DetectStatus>("loading");
  const [signals, setSignals] = useState<FocusFaceSignals | null>(null);

  const containerRef = useRef<View | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // FaceLandmarker 인스턴스(동적 import 타입). 프레임을 받아 숫자만 반환한다.
  const landmarkerRef = useRef<{ detectForVideo: (v: HTMLVideoElement, t: number) => unknown; close: () => void } | null>(
    null
  );
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    function cleanup() {
      if (rafRef.current != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
          video.srcObject = null;
          if (video.parentNode) video.parentNode.removeChild(video);
        } catch {
          // ignore teardown errors
        }
      }
      videoRef.current = null;
      if (streamRef.current) {
        // 카메라 트랙 즉시 정지 — 프레임이 더 이상 흐르지 않게.
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close();
        } catch {
          // ignore
        }
        landmarkerRef.current = null;
      }
    }

    function loop() {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (cancelled || !video || !landmarker) return;
      if (video.readyState >= 2) {
        try {
          // 프레임을 온디바이스에서 분석 → 숫자 신호만 추출하고 프레임은 즉시 버린다(저장/전송 없음).
          const result = landmarker.detectForVideo(video, performance.now());
          setSignals(getSignalsFromMediaPipeFaceLandmarker(result as never));
        } catch {
          // 한 프레임 실패는 무시하고 계속.
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      setStatus("loading");
      try {
        const vision = await loadVisionModule();
        const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.style.width = "100%";
        video.style.height = "100%";
        video.style.objectFit = "cover";
        video.style.transform = "scaleX(-1)"; // 거울 모드 프리뷰
        videoRef.current = video;

        // 로컬 프리뷰만 표시 — 화면 밖으로 나가지 않는다.
        const container = containerRef.current as unknown as { appendChild?: (node: Node) => void } | null;
        if (container && typeof container.appendChild === "function") {
          container.appendChild(video);
        }

        await video.play();
        if (cancelled) return;
        setStatus("running");
        loop();
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
          setStatus("denied");
        } else {
          setStatus("error");
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      cleanup();
      setSignals(null);
    };
  }, [active]);

  if (!active) {
    return (
      <FallbackCard
        body="일시정지 중에는 카메라도 꺼져요. 다시 시작하면 얼굴 인식을 이어가요."
        style={style}
        title="집중 타이머가 멈춰 있어요"
      />
    );
  }

  if (status === "unsupported") {
    return (
      <FallbackCard
        body="이 브라우저/환경에서는 카메라를 쓸 수 없어요. 타이머는 계속 정상 동작해요."
        style={style}
        title={getFocusCameraFallbackTitle("unsupported_environment")}
      />
    );
  }

  if (status === "denied") {
    return (
      <FallbackCard
        body="브라우저 주소창의 카메라 아이콘에서 권한을 허용한 뒤 다시 시작해 주세요. 권한 없이도 타이머는 계속 써요."
        style={style}
        title="카메라 권한이 필요해요"
      />
    );
  }

  if (status === "error") {
    return (
      <FallbackCard
        body="카메라를 시작하지 못했어요. 잠시 후 다시 시도해 주세요. 타이머는 계속 정상 동작해요."
        style={style}
        title={getFocusCameraFallbackTitle("model_unavailable")}
      />
    );
  }

  const openness = signals ? eyeOpenness(signals) : null;
  const facePresent = Boolean(signals?.facePresent);

  return (
    <View style={[styles.panel, style]}>
      <View ref={containerRef} style={styles.preview} />

      <View style={styles.readoutRow}>
        <View style={styles.statusDotWrap}>
          <View style={[styles.statusDot, facePresent ? styles.statusDotOn : styles.statusDotWarn]} />
          <Text style={styles.statusText}>{facePresent ? "얼굴 인식 중" : "얼굴이 보이지 않아요"}</Text>
        </View>
      </View>

      {facePresent && signals ? (
        <View style={styles.metricsRow}>
          <Metric label="눈 뜬 정도" value={openness != null ? openness.toFixed(2) : "—"} />
          <Metric label="고개(상하)" value={formatDeg(signals.pitchDeg)} />
          <Metric label="고개(좌우)" value={formatDeg(signals.yawDeg)} />
          <Metric label="고개(기울임)" value={formatDeg(signals.rollDeg)} />
        </View>
      ) : (
        <Text style={styles.hintText}>
          {status === "loading" ? "얼굴 인식을 준비하고 있어요…" : "카메라 앞에 얼굴을 보여 주세요."}
        </Text>
      )}

      <Text style={styles.debugNote}>* 1단계 디버그 표시 — 졸음 판단·기록은 다음 단계예요.</Text>

      <View style={styles.privacyNotice}>
        <Text style={styles.privacyTitle}>{FOCUS_CAMERA_PRIVACY_COPY}</Text>
        <Text style={styles.privacyBody}>
          얼굴에서 숫자만 읽고 화면(프레임)은 곧바로 버려요. 저장·업로드하지 않아요.
        </Text>
      </View>
    </View>
  );
}

export function FocusCameraPermissionGate({ style }: PermissionGateProps) {
  return (
    <FallbackCard
      body="집중 모드를 켜면 전면 카메라로 얼굴을 인식해요. 영상은 저장·전송하지 않고 숫자만 읽어요."
      style={style}
      title="집중 모드 카메라 안내"
    />
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function FallbackCard({
  body,
  style,
  title
}: {
  body: string;
  style?: StyleProp<ViewStyle>;
  title: string;
}) {
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.panelTop}>
        <View style={styles.iconBox}>
          <Text style={styles.iconText}>⌁</Text>
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.panelTitle}>{title}</Text>
          <Text style={styles.panelBody}>{body}</Text>
        </View>
      </View>
      <View style={styles.privacyNotice}>
        <Text style={styles.privacyTitle}>{FOCUS_CAMERA_PRIVACY_COPY}</Text>
        <Text style={styles.privacyBody}>프레임과 영상은 저장하거나 업로드하지 않아요.</Text>
      </View>
      <Pressable accessibilityRole="button" disabled style={[styles.button, styles.disabledButton]}>
        <Text style={styles.disabledButtonText}>{FOCUS_CAMERA_TIMER_ONLY_COPY}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  preview: {
    width: "100%",
    height: 200,
    overflow: "hidden",
    borderRadius: radii.control,
    backgroundColor: colors.ink
  },
  readoutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  statusDotWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  statusDotOn: {
    backgroundColor: colors.success
  },
  statusDotWarn: {
    backgroundColor: colors.warning
  },
  statusText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900"
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  metric: {
    flex: 1,
    minWidth: 72,
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  metricValue: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  hintText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21
  },
  debugNote: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  panelTop: {
    flexDirection: "row",
    gap: spacing.md
  },
  titleWrap: {
    flex: 1,
    gap: spacing.xs
  },
  iconBox: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button,
    backgroundColor: "#FFE8DF"
  },
  iconText: {
    color: colors.flame,
    fontSize: 18,
    fontWeight: "900"
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24
  },
  panelBody: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21
  },
  privacyNotice: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#BFEFD7",
    borderRadius: radii.control,
    backgroundColor: "#F0FFF7"
  },
  privacyTitle: {
    color: "#087A47",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20
  },
  privacyBody: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.button
  },
  disabledButton: {
    backgroundColor: colors.canvas
  },
  disabledButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "900"
  }
});
