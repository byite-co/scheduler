import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "@ssamplanner/design-tokens";

export type IconName = "dashboard" | "students" | "bell" | "settings" | "mail" | "lock" | "arrowLeft" | "check" | "book";

const glyphs: Record<IconName, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  dashboard: "view-dashboard-outline",
  students: "account-group-outline",
  bell: "bell-outline",
  settings: "cog-outline",
  mail: "email-outline",
  lock: "lock-outline",
  arrowLeft: "arrow-left",
  check: "check",
  book: "file-document-outline"
};

export function AppIcon({ name, size = 22, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={glyphs[name]} size={size} color={color} />;
}
