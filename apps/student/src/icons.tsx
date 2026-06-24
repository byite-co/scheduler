import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors } from "@ssamplanner/design-tokens";

// 카탈로그의 가는 단색 라인 아이콘 톤에 맞춘 단일 패밀리(MaterialCommunityIcons outline).
// 이모지/유니코드 대신 이 매핑만 사용한다. 색은 항상 토큰으로 전달.
export type IconName =
  | "today"
  | "planner"
  | "peer"
  | "ai"
  | "records"
  | "clock"
  | "lock"
  | "focus"
  | "flame"
  | "play"
  | "pause"
  | "stop"
  | "camera"
  | "bell"
  | "check"
  | "chevron"
  | "ad"
  | "note"
  | "person"
  | "mail"
  | "doc"
  | "alert";

const GLYPHS: Record<IconName, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  today: "home-variant-outline",
  planner: "clipboard-text-outline",
  peer: "account-group-outline",
  ai: "star-four-points-outline",
  records: "chart-bar",
  clock: "clock-outline",
  lock: "lock-outline",
  focus: "eye-outline",
  flame: "fire",
  play: "play",
  pause: "pause",
  stop: "stop",
  camera: "camera-outline",
  bell: "bell-outline",
  check: "check",
  chevron: "chevron-right",
  ad: "play-circle-outline",
  note: "note-text-outline",
  person: "account-outline",
  mail: "email-outline",
  doc: "file-document-outline",
  alert: "alert-outline"
};

export function AppIcon({
  name,
  size = 22,
  color = colors.ink
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <MaterialCommunityIcons name={GLYPHS[name]} size={size} color={color} />;
}
