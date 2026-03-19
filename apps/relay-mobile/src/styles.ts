import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: "#fbfaf5",
  },
  preview: {
    color: "#655647",
    fontSize: 13,
    lineHeight: 18,
  },
  cardTitle: {
    color: "#211b12",
    fontSize: 20,
    fontWeight: "700",
  },
  meta: {
    color: "#655647",
    fontSize: 14,
    lineHeight: 20,
  },
  redirectValue: {
    borderWidth: 1,
    borderColor: "rgba(15, 97, 93, 0.18)",
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    color: "#211b12",
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sectionTitle: {
    color: "#211b12",
    fontSize: 18,
    fontWeight: "700",
  },
  statusTitle: {
    color: "#211b12",
    fontSize: 22,
    fontWeight: "800",
  },
  list: {
    gap: 10,
  },
  threadRow: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(15, 97, 93, 0.14)",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    padding: 14,
    gap: 4,
  },
  threadRowActive: {
    borderColor: "#0f615d",
    backgroundColor: "rgba(15, 97, 93, 0.08)",
  },
  threadProject: {
    color: "#0f615d",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  threadTitle: {
    color: "#211b12",
    fontSize: 15,
    fontWeight: "600",
  },
  messageCard: {
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    padding: 12,
    gap: 6,
  },
  messageRole: {
    color: "#0f615d",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  messageContent: {
    color: "#211b12",
    fontSize: 15,
    lineHeight: 22,
  },
  pairingCode: {
    color: "#0f615d",
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 4,
  },
  statusOnline: {
    color: "#13785f",
    fontSize: 14,
    fontWeight: "700",
  },
  statusOffline: {
    color: "#a14f2b",
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: "#ae402d",
    fontSize: 14,
    lineHeight: 20,
  },
});
