import { StyleSheet } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";

export const homeworkStyles = StyleSheet.create({
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
    fontSize: 19,
    fontWeight: "900"
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.chip,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  chipSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand
  },
  chipText: {
    color: colors.ink,
    fontSize: 15,
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
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  fieldMultiline: {
    minHeight: 96,
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
    backgroundColor: tints.brandSoft,
    borderRadius: radii.card,
    gap: spacing.xs,
    padding: spacing.lg
  },
  noticeTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.button,
    borderWidth: 1.5,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: spacing.lg
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  statusConfirmed: {
    backgroundColor: tints.successSoft
  },
  statusPending: {
    backgroundColor: tints.warningSoft
  },
  statusPrivate: {
    backgroundColor: tints.brandSoft
  },
  statusRejected: {
    backgroundColor: tints.dangerSoft
  },
  statusText: {
    fontSize: 13,
    fontWeight: "900"
  },
  switchRow: {
    alignItems: "center",
    backgroundColor: tints.flameNudge,
    borderColor: tints.flameNudgeBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.lg
  }
});
