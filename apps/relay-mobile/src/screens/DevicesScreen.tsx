import type { PairingCodeCreateResponse, RelayAuthSession, RelayDeviceSummary } from "@remote-codex/contracts";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createPairingCode, fetchDevices } from "../lib/relay-api";

const palette = {
  background: "#faf9f7",
  surface: "#ffffff",
  surfaceMuted: "#f4f3f1",
  border: "rgba(192, 200, 201, 0.16)",
  borderSoft: "rgba(192, 200, 201, 0.2)",
  ink: "#002428",
  inkMuted: "#404849",
  inkSubtle: "#717879",
  deep: "#002428",
  deepSoft: "#0d3b3f",
  mint: "#bfeaef",
  mintText: "#234d51",
  online: "#2ecc71",
  offline: "#717879",
  offlineCard: "rgba(244, 243, 241, 0.72)",
  disabled: "#e3e2e0",
  danger: "#b24534",
};

function formatOfflineStatus(lastSeenAt: string | null) {
  if (!lastSeenAt) {
    return "OFFLINE";
  }

  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return "OFFLINE";
  }

  const minutes = Math.max(1, Math.round(diffMs / 60_000));
  if (minutes < 60) {
    return `OFFLINE • ${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `OFFLINE • ${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  return `OFFLINE • ${days}d ago`;
}

function buildVersionLines(device: RelayDeviceSummary) {
  return [`p ${device.protocolVersion}`, `app ${device.appVersion}`];
}

function getDeviceIcon(device: RelayDeviceSummary) {
  const name = device.displayName.toLowerCase();
  if (name.includes("ipad") || name.includes("tablet")) {
    return "tablet-cellphone";
  }
  if (name.includes("ubuntu") || name.includes("edge") || name.includes("node") || name.includes("server")) {
    return "server";
  }
  return "laptop";
}

function sortDevices(devices: RelayDeviceSummary[]) {
  return [...devices].sort((left, right) => {
    if (left.connected !== right.connected) {
      return left.connected ? -1 : 1;
    }

    const leftSeen = left.lastSeenAt ? new Date(left.lastSeenAt).getTime() : 0;
    const rightSeen = right.lastSeenAt ? new Date(right.lastSeenAt).getTime() : 0;
    return rightSeen - leftSeen;
  });
}

export function DevicesScreen({
  session,
  authToken,
  onOpenDevice,
  onSignOut,
  previewDevices,
}: {
  session: RelayAuthSession;
  authToken: string;
  onOpenDevice: (deviceId: string) => void;
  onSignOut: () => void;
  previewDevices?: RelayDeviceSummary[];
}) {
  const [devices, setDevices] = useState<RelayDeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<PairingCodeCreateResponse | null>(null);
  const [pairingPending, setPairingPending] = useState(false);

  useEffect(() => {
    if (previewDevices) {
      setDevices(previewDevices);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    void fetchDevices(authToken)
      .then((result) => {
        setDevices(result.devices || []);
        setError(null);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [authToken, previewDevices, session.user?.email]);

  const sortedDevices = useMemo(() => sortDevices(devices), [devices]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <View style={styles.brandRow}>
              <MaterialCommunityIcons color={palette.deepSoft} name="console-line" size={20} />
              <Text style={styles.brandText}>REMOTE CODEX RELAY</Text>
            </View>
            <Pressable accessibilityLabel="Sign out" onPress={onSignOut} style={styles.avatarButton}>
              <View style={styles.avatarInner}>
                <Ionicons color={palette.deepSoft} name="person" size={18} />
              </View>
            </Pressable>
          </View>

          <View style={styles.heroSection}>
            <Text style={styles.heroTitle}>Connected Devices</Text>
            <Text style={styles.heroSubtitle}>
              Select a terminal to enter your workspace or authorize a new node.
            </Text>
          </View>

          <Pressable
            disabled={pairingPending}
            onPress={() => {
              if (previewDevices) {
                setPairingCode({
                  code: "8D1F4A29",
                  ownerLabel: session.user?.email || "preview-user",
                  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                });
                return;
              }

              setPairingPending(true);
              setError(null);
              void createPairingCode(authToken, session.user?.email || "remote-codex-owner")
                .then((result) => setPairingCode(result))
                .catch((caught: Error) => setError(caught.message))
                .finally(() => setPairingPending(false));
            }}
            style={({ pressed }) => [styles.pairingCard, pressed && !pairingPending && styles.pairingCardPressed]}
          >
            <View style={styles.pairingTextColumn}>
              <Text style={styles.pairingKicker}>{pairingPending ? "Authorizing" : "New Connection"}</Text>
              <Text style={styles.pairingTitle}>{pairingPending ? "Creating Pairing\nCode" : "Create Pairing\nCode"}</Text>
            </View>
            <View style={styles.pairingIconShell}>
              {pairingPending ? (
                <ActivityIndicator color={palette.deep} size="small" />
              ) : (
                <MaterialCommunityIcons color={palette.deep} name="qrcode-scan" size={24} />
              )}
            </View>
          </Pressable>

          {pairingCode ? (
            <View style={styles.pairingResultCard}>
              <Text style={styles.pairingResultLabel}>Pairing Code</Text>
              <Text style={styles.pairingResultCode}>{pairingCode.code}</Text>
              <Text style={styles.pairingResultMeta}>Expires at {new Date(pairingCode.expiresAt).toLocaleString()}</Text>
              <Text style={styles.pairingResultMeta}>Use this code in the local node pairing flow.</Text>
            </View>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Active Nodes ({devices.length})</Text>
            <Ionicons color={palette.inkSubtle} name="filter-outline" size={18} />
          </View>

          {loading ? (
            <View style={styles.feedbackCard}>
              <ActivityIndicator color={palette.deepSoft} size="large" />
              <Text style={styles.feedbackText}>Loading connected devices…</Text>
            </View>
          ) : null}

          {!loading && !sortedDevices.length ? (
            <View style={styles.feedbackCard}>
              <Text style={styles.feedbackTitle}>No devices yet</Text>
              <Text style={styles.feedbackText}>Create a pairing code to authorize your first relay node.</Text>
            </View>
          ) : null}

          {sortedDevices.map((device) => {
            const [versionTop, versionBottom] = buildVersionLines(device);
            const isOffline = !device.connected;
            return (
              <View key={device.deviceId} style={[styles.deviceCard, isOffline && styles.deviceCardOffline]}>
                <View style={styles.deviceRow}>
                  <View style={styles.deviceIdentity}>
                    <View style={[styles.deviceIconShell, isOffline && styles.deviceIconShellOffline]}>
                      <MaterialCommunityIcons
                        color={isOffline ? palette.offline : palette.deepSoft}
                        name={getDeviceIcon(device)}
                        size={22}
                      />
                    </View>
                    <View style={styles.deviceTextColumn}>
                      <Text numberOfLines={2} style={[styles.deviceName, isOffline && styles.deviceNameOffline]}>
                        {device.displayName}
                      </Text>
                      <View style={styles.statusRow}>
                        <View style={[styles.statusDot, isOffline && styles.statusDotOffline]} />
                        <Text style={[styles.statusText, isOffline && styles.statusTextOffline]}>
                          {device.connected ? "ONLINE" : formatOfflineStatus(device.lastSeenAt)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={[styles.versionChip, isOffline && styles.versionChipOffline]}>
                    <Text numberOfLines={1} style={[styles.versionChipText, isOffline && styles.versionChipTextOffline]}>
                      {versionTop}
                    </Text>
                    <Text numberOfLines={1} style={[styles.versionChipSubtext, isOffline && styles.versionChipTextOffline]}>
                      {versionBottom}
                    </Text>
                  </View>
                </View>

                <Pressable
                  accessibilityLabel={`Open workspace for ${device.displayName}`}
                  disabled={!device.connected}
                  onPress={() => onOpenDevice(device.deviceId)}
                  style={[styles.workspaceButton, isOffline && styles.workspaceButtonDisabled]}
                >
                  <Text style={[styles.workspaceButtonLabel, isOffline && styles.workspaceButtonLabelDisabled]}>
                    Enter Workspace
                  </Text>
                  <Ionicons
                    color={isOffline ? palette.inkSubtle : "#ffffff"}
                    name={device.connected ? "arrow-forward" : "lock-closed-outline"}
                    size={14}
                  />
                </Pressable>
              </View>
            );
          })}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 32,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandText: {
    color: palette.deepSoft,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.9,
  },
  avatarButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: palette.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInner: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: "#fce4cc",
    alignItems: "center",
    justifyContent: "center",
  },
  heroSection: {
    gap: 8,
  },
  heroTitle: {
    color: palette.ink,
    fontSize: 36,
    lineHeight: 40,
    fontWeight: "800",
    letterSpacing: -0.9,
  },
  heroSubtitle: {
    color: palette.inkMuted,
    fontSize: 18,
    lineHeight: 29,
  },
  pairingCard: {
    borderRadius: 32,
    backgroundColor: palette.deep,
    padding: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: palette.deep,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  pairingCardPressed: {
    opacity: 0.92,
  },
  pairingTextColumn: {
    gap: 4,
    maxWidth: "72%",
  },
  pairingKicker: {
    color: palette.mint,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  pairingTitle: {
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
  },
  pairingIconShell: {
    width: 55,
    height: 55,
    borderRadius: 18,
    backgroundColor: palette.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  pairingResultCard: {
    borderRadius: 24,
    backgroundColor: palette.surface,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 6,
    borderWidth: 1,
    borderColor: palette.border,
  },
  pairingResultLabel: {
    color: palette.inkSubtle,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  pairingResultCode: {
    color: palette.deep,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 4,
  },
  pairingResultMeta: {
    color: palette.inkMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    marginTop: -8,
  },
  sectionLabel: {
    color: palette.inkSubtle,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  feedbackCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  feedbackTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  feedbackText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  deviceCard: {
    borderRadius: 32,
    backgroundColor: palette.surface,
    padding: 25,
    gap: 24,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(192, 200, 201, 0.1)",
  },
  deviceCardOffline: {
    backgroundColor: palette.offlineCard,
    borderColor: palette.borderSoft,
  },
  deviceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
  },
  deviceIdentity: {
    flex: 1,
    flexDirection: "row",
    gap: 16,
    alignItems: "flex-start",
  },
  deviceIconShell: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#e9e8e6",
    alignItems: "center",
    justifyContent: "center",
  },
  deviceIconShellOffline: {
    backgroundColor: "rgba(233, 232, 230, 0.4)",
  },
  deviceTextColumn: {
    flex: 1,
    gap: 4,
  },
  deviceName: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "700",
  },
  deviceNameOffline: {
    color: palette.inkMuted,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.online,
    shadowColor: palette.online,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  statusDotOffline: {
    backgroundColor: palette.offline,
    shadowOpacity: 0,
  },
  statusText: {
    color: palette.online,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
    letterSpacing: 0.55,
    textTransform: "uppercase",
  },
  statusTextOffline: {
    color: palette.offline,
  },
  versionChip: {
    minWidth: 84,
    borderRadius: 6,
    backgroundColor: palette.mint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 2,
  },
  versionChipOffline: {
    backgroundColor: palette.disabled,
  },
  versionChipText: {
    color: palette.mintText,
    fontSize: 10,
    lineHeight: 15,
  },
  versionChipSubtext: {
    color: palette.mintText,
    fontSize: 10,
    lineHeight: 15,
  },
  versionChipTextOffline: {
    color: palette.inkSubtle,
  },
  workspaceButton: {
    borderRadius: 32,
    backgroundColor: palette.deep,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  workspaceButtonDisabled: {
    backgroundColor: palette.disabled,
    opacity: 0.6,
  },
  workspaceButtonLabel: {
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    letterSpacing: 0.35,
  },
  workspaceButtonLabelDisabled: {
    color: palette.inkSubtle,
  },
  errorText: {
    color: palette.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
