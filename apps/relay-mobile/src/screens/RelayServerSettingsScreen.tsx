import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Card, ErrorText, Field, Label } from "../components/ui";
import { getDefaultRelayServerUrl, setCurrentServerUrl } from "../lib/auth";

export function RelayServerSettingsScreen({
  currentServerUrl,
  onClose,
  onServerUrlChange,
}: {
  currentServerUrl: string | null;
  onClose: () => void;
  onServerUrlChange: (serverUrl: string) => void;
}) {
  const defaultRelayServerUrl = useMemo(() => getDefaultRelayServerUrl(), []);
  const [serverUrl, setServerUrl] = useState(currentServerUrl || defaultRelayServerUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.background}>
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.shell}>
          <View style={styles.topBar}>
            <Pressable accessibilityLabel="Back" onPress={onClose} style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}>
              <Ionicons color="#0f615d" name="chevron-back" size={20} />
            </Pressable>
            <Text style={styles.title}>Relay Server Settings</Text>
            <View style={styles.topBarSpacer} />
          </View>

          <View style={styles.body}>
            <Card>
              <Label>Relay Server URL</Label>
              <Field
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                keyboardType="url"
                onChangeText={setServerUrl}
                placeholder={defaultRelayServerUrl}
                value={serverUrl}
              />
              <Text style={styles.hint}>Default relay: {defaultRelayServerUrl}</Text>
              <Button
                disabled={saving || !serverUrl.trim()}
                label={saving ? "Saving..." : "Save"}
                onPress={() => {
                  setSaving(true);
                  setError(null);
                  void setCurrentServerUrl(serverUrl)
                    .then((normalized) => {
                      onServerUrlChange(normalized);
                      onClose();
                    })
                    .catch((caught: Error) => setError(caught.message))
                    .finally(() => setSaving(false));
                }}
              />
              {error ? <ErrorText>{error}</ErrorText> : null}
            </Card>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fbfaf5",
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  glowTop: {
    position: "absolute",
    top: -120,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(255, 219, 170, 0.5)",
  },
  glowBottom: {
    position: "absolute",
    right: -60,
    bottom: -120,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(15, 97, 93, 0.08)",
  },
  safeArea: {
    flex: 1,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    shadowColor: "#211b12",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  backButtonPressed: {
    opacity: 0.88,
  },
  title: {
    color: "#211b12",
    fontSize: 18,
    fontWeight: "700",
  },
  topBarSpacer: {
    width: 44,
  },
  body: {
    flex: 1,
    justifyContent: "center",
  },
  hint: {
    color: "#5d625e",
    fontSize: 13,
    lineHeight: 18,
  },
});
