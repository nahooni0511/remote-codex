import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  preview: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
  },
  cardTitle: {
    color: "#0f172a",
    fontSize: 20,
    fontWeight: "700",
  },
  meta: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700",
  },
  list: {
    gap: 10,
  },
  threadRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 4,
  },
  threadRowActive: {
    borderColor: "#fb923c",
    backgroundColor: "#fff7ed",
  },
  threadProject: {
    color: "#c2410c",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  threadTitle: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "600",
  },
  messageCard: {
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 6,
  },
  messageRole: {
    color: "#c2410c",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  messageContent: {
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 22,
  },
});
