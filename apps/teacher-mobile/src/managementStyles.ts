import { StyleSheet } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";

export const managementStyles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.chip,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  chipSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand
  },
  chipText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800"
  },
  chipTextSelected: {
    color: colors.surface
  },
  field: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.button,
    borderWidth: 1.5,
    color: colors.ink,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  fieldMultiline: {
    minHeight: 88,
    textAlignVertical: "top"
  },
  label: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "800"
  },
  meta: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20
  },
  notice: {
    backgroundColor: tints.warningSoft,
    borderColor: tints.warningBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.lg
  },
  noticeTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.button,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 64,
    padding: spacing.lg
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.button,
    borderWidth: 1.5,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  stat: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.card,
    borderWidth: 1,
    flexBasis: "30%",
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 96,
    padding: spacing.md
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  statValue: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900"
  },
  unread: {
    backgroundColor: tints.brandSoft,
    borderColor: colors.brand
  }
});
