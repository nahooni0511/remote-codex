import { StyleSheet } from "react-native";

export const appPalette = {
  background: "#0a0f10",
  surface: "#12191b",
  surfaceMuted: "#171f22",
  surfaceElevated: "#10171a",
  border: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(255, 255, 255, 0.14)",
  text: "#f5f8f7",
  muted: "#a2acab",
  subtle: "#7d8684",
  accent: "#87d8c3",
  accentStrong: "#174447",
  accentSoft: "rgba(135, 216, 195, 0.14)",
  accentSurface: "rgba(255, 255, 255, 0.04)",
  danger: "#ffb09a",
  online: "#57d38c",
  offline: "#7d8684",
  glowTop: "rgba(135, 216, 195, 0.18)",
  glowBottom: "rgba(32, 53, 61, 0.42)",
} as const;

export const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: appPalette.background,
  },
  preview: {
    color: appPalette.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  cardTitle: {
    color: appPalette.text,
    fontSize: 20,
    fontWeight: "700",
  },
  meta: {
    color: appPalette.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  redirectValue: {
    borderWidth: 1,
    borderColor: appPalette.borderStrong,
    borderRadius: 16,
    backgroundColor: appPalette.surface,
    color: appPalette.text,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sectionTitle: {
    color: appPalette.text,
    fontSize: 18,
    fontWeight: "700",
  },
  statusTitle: {
    color: appPalette.text,
    fontSize: 22,
    fontWeight: "800",
  },
  list: {
    gap: 10,
  },
  threadRow: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: appPalette.border,
    backgroundColor: appPalette.surface,
    padding: 14,
    gap: 4,
  },
  threadRowActive: {
    borderColor: appPalette.accent,
    backgroundColor: appPalette.accentSoft,
  },
  threadProject: {
    color: appPalette.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  threadTitle: {
    color: appPalette.text,
    fontSize: 15,
    fontWeight: "600",
  },
  messageCard: {
    borderRadius: 18,
    backgroundColor: appPalette.surface,
    padding: 12,
    gap: 6,
  },
  messageRole: {
    color: appPalette.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  messageContent: {
    color: appPalette.text,
    fontSize: 15,
    lineHeight: 22,
  },
  pairingCode: {
    color: appPalette.accent,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 4,
  },
  statusOnline: {
    color: appPalette.online,
    fontSize: 14,
    fontWeight: "700",
  },
  statusOffline: {
    color: appPalette.danger,
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: appPalette.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
