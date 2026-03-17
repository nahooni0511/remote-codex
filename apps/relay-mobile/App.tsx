import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import type { RelayAuthSession, RelayDeviceSummary } from "@remote-codex/contracts";
import { View } from "react-native";

import { styles } from "./src/styles";
import { DevicesScreen } from "./src/screens/DevicesScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { WorkspaceScreen } from "./src/screens/WorkspaceScreen";

export default function App() {
  const [session, setSession] = useState<RelayAuthSession | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<RelayDeviceSummary | null>(null);

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      {!session || !sessionToken ? (
        <LoginScreen
          onAuthenticated={(nextSession, nextSessionToken) => {
            setSession(nextSession);
            setSessionToken(nextSessionToken);
          }}
        />
      ) : selectedDevice ? (
        <WorkspaceScreen sessionToken={sessionToken} device={selectedDevice} onBack={() => setSelectedDevice(null)} />
      ) : (
        <DevicesScreen session={session} sessionToken={sessionToken} onOpenDevice={setSelectedDevice} />
      )}
    </View>
  );
}
