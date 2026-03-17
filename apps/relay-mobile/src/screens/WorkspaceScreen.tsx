import { Pressable, Text, View } from "react-native";
import type { RelayDeviceSummary } from "@remote-codex/contracts";

import { Screen } from "../components/Screen";
import { Button, Card, ErrorText } from "../components/ui";
import { useRelayWorkspace } from "../hooks/useRelayWorkspace";
import { styles } from "../styles";

export function WorkspaceScreen({
  sessionToken,
  device,
  onBack,
}: {
  sessionToken: string;
  device: RelayDeviceSummary;
  onBack: () => void;
}) {
  const { blockedReason, error, loading, messages, openThread, projects, selectedThreadId, selectedThreadTitle } =
    useRelayWorkspace({ device, sessionToken });

  return (
    <Screen title={device.displayName} subtitle={blockedReason || "Shared workspace rendered through the relay bridge."} loading={loading}>
      <Card>
        <Button label="Back to Devices" tone="ghost" onPress={onBack} />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Text style={styles.sectionTitle}>Threads</Text>
        <View style={styles.list}>
          {projects.flatMap((project) =>
            project.threads.map((thread) => (
              <Pressable
                key={thread.id}
                onPress={() => void openThread(thread.id)}
                style={[styles.threadRow, selectedThreadId === thread.id && styles.threadRowActive]}
              >
                <Text style={styles.threadProject}>{project.name}</Text>
                <Text style={styles.threadTitle}>{thread.title}</Text>
              </Pressable>
            )),
          )}
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{selectedThreadTitle || "Messages"}</Text>
        <View style={styles.list}>
          {messages.map((message) => (
            <View key={message.id} style={styles.messageCard}>
              <Text style={styles.messageRole}>{message.role}</Text>
              <Text style={styles.messageContent}>{message.content}</Text>
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
