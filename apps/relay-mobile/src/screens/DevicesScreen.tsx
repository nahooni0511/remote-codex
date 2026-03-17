import { useEffect, useState } from "react";
import { Text } from "react-native";
import type { RelayAuthSession, RelayDeviceSummary } from "@remote-codex/contracts";

import { Screen } from "../components/Screen";
import { Button, Card, ErrorText } from "../components/ui";
import { fetchDevices, fetchSession } from "../lib/relay";
import { styles } from "../styles";

export function DevicesScreen({
  session,
  sessionToken,
  onOpenDevice,
}: {
  session: RelayAuthSession;
  sessionToken: string;
  onOpenDevice: (device: RelayDeviceSummary) => void;
}) {
  const [devices, setDevices] = useState<RelayDeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void fetchSession(sessionToken)
      .then(() => fetchDevices(sessionToken))
      .then((result) => setDevices(result.devices || []))
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [sessionToken]);

  return (
    <Screen
      title="Connected Devices"
      subtitle={`Signed in as ${session.user?.email || "unknown"}. Choose a relay-backed workspace.`}
      loading={loading}
    >
      {devices.map((device) => (
        <Card key={device.deviceId}>
          <Text style={styles.cardTitle}>{device.displayName}</Text>
          <Text style={styles.meta}>
            {device.connected ? "Online" : "Offline"} · Protocol {device.protocolVersion} · App {device.appVersion}
          </Text>
          {device.blockedReason ? <ErrorText>{device.blockedReason.message}</ErrorText> : null}
          <Button label="Open Workspace" disabled={!device.connected} onPress={() => onOpenDevice(device)} />
        </Card>
      ))}
      {!loading && !devices.length ? (
        <Card>
          <Text style={styles.cardTitle}>No devices</Text>
          <Text style={styles.meta}>No relay-connected devices are available.</Text>
        </Card>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
