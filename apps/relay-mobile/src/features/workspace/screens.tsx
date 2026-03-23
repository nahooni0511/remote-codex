import type { AppUpdateApplyResult, AppUpdateStatus } from "@remote-codex/contracts";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";

import { CenteredStatus } from "../../components/CenteredStatus";
import { Button, Card, ErrorText } from "../../components/ui";
import type { PreviewWorkspace } from "../../lib/preview";
import { applyBlockedUpdate, fetchBlockedUpdateStatus } from "../../lib/relay-api";
import { createWorkspaceThread } from "../../lib/workspace-session";
import type { AppStackParamList } from "../../navigation/types";
import { useWorkspaceChatController, useWorkspaceRouteState } from "./hooks";
import { styles } from "./styles";
import { ChatView, ConnectingWorkspaceView, ProjectListView, ThreadListView } from "./views";

type ProjectsScreenProps = {
  authToken: string;
  fallbackDeviceId: string | null;
  navigation: NativeStackNavigationProp<AppStackParamList, "Projects">;
  onExitDevice: () => Promise<void>;
  preview?: PreviewWorkspace | null;
  route: RouteProp<AppStackParamList, "Projects">;
};

type ThreadsScreenProps = {
  authToken: string;
  navigation: NativeStackNavigationProp<AppStackParamList, "Threads">;
  preview?: PreviewWorkspace | null;
  route: RouteProp<AppStackParamList, "Threads">;
};

type ChatScreenProps = {
  authToken: string;
  authUserName: string;
  navigation: NativeStackNavigationProp<AppStackParamList, "Chat">;
  preview?: PreviewWorkspace | null;
  route: RouteProp<AppStackParamList, "Chat">;
};

function WorkspaceBlockedState({
  authToken,
  deviceId,
  displayName,
  message,
  onBack,
  retry,
}: {
  authToken: string;
  deviceId: string | null;
  displayName: string | null;
  message: string | null;
  onBack: () => void;
  retry: () => void;
}) {
  const [status, setStatus] = useState<AppUpdateStatus | AppUpdateApplyResult | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <View style={styles.stateRoot}>
      <CenteredStatus
        description={message || "This device requires a newer local runtime."}
        title={displayName || "Protocol Blocked"}
      />
      <View style={styles.stateActions}>
        <Card tone="muted">
          <Text style={styles.blockedTitle}>Protocol Blocked</Text>
          <Text style={styles.blockedText}>
            Check for a compatible update or apply the available update path on the remote device.
          </Text>
          <Button
            disabled={pending !== null || !deviceId}
            label={pending === "check" ? "Checking..." : "Check Update"}
            onPress={() => {
              if (!deviceId) {
                return;
              }

              setPending("check");
              setActionError(null);
              void fetchBlockedUpdateStatus(authToken, deviceId)
                .then((result) => {
                  setStatus(result);
                  retry();
                })
                .catch((caught: Error) => setActionError(caught.message))
                .finally(() => setPending(null));
            }}
          />
          <Button
            disabled={pending !== null || !deviceId}
            label={pending === "apply" ? "Updating..." : "Apply Update"}
            onPress={() => {
              if (!deviceId) {
                return;
              }

              setPending("apply");
              setActionError(null);
              void applyBlockedUpdate(authToken, deviceId)
                .then((result) => {
                  setStatus(result);
                  retry();
                })
                .catch((caught: Error) => setActionError(caught.message))
                .finally(() => setPending(null));
            }}
            tone="secondary"
          />
          <Button label="Back" onPress={onBack} tone="ghost" />
          {status ? (
            <Card tone="muted">
              <Text style={styles.blockedTitle}>{status.updateAvailable ? "Update available" : "No update available"}</Text>
              <Text style={styles.blockedText}>{status.reason || "The relay returned a status without a reason."}</Text>
            </Card>
          ) : null}
          {actionError ? <ErrorText>{actionError}</ErrorText> : null}
        </Card>
      </View>
    </View>
  );
}

export function WorkspaceProjectsScreen({
  authToken,
  fallbackDeviceId,
  navigation,
  onExitDevice,
  preview = null,
  route,
}: ProjectsScreenProps) {
  const deviceId = route.params?.deviceId ?? fallbackDeviceId;
  const { device, error, phase, projects, retry } = useWorkspaceRouteState(authToken, deviceId, preview);

  function handleBackToDevices() {
    void onExitDevice();
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.reset({ index: 0, routes: [{ name: "Devices" }] });
  }

  if (!deviceId) {
    return (
      <View style={styles.stateRoot}>
        <CenteredStatus description="No device was selected for this workspace." title="Workspace unavailable" />
        <View style={styles.stateActions}>
          <Button label="Back to Devices" onPress={handleBackToDevices} />
        </View>
      </View>
    );
  }

  if (phase === "connecting") {
    return <ConnectingWorkspaceView />;
  }

  if (phase === "error") {
    return (
      <View style={styles.stateRoot}>
        <CenteredStatus description={error || "The selected device could not be opened."} title="Workspace unavailable" />
        <View style={styles.stateActions}>
          <Button label="Retry Connection" onPress={retry} />
          <Button label="Back to Devices" onPress={handleBackToDevices} tone="secondary" />
        </View>
      </View>
    );
  }

  if (phase === "blocked") {
    return (
      <WorkspaceBlockedState
        authToken={authToken}
        deviceId={device?.deviceId || null}
        displayName={device?.displayName || null}
        message={device?.blockedReason?.message || null}
        onBack={handleBackToDevices}
        retry={retry}
      />
    );
  }

  return (
    <ProjectListView
      deviceName={device?.displayName || "Workspace"}
      error={error}
      onBack={handleBackToDevices}
      onOpenProject={(projectId) => navigation.push("Threads", { deviceId, projectId })}
      projects={projects}
    />
  );
}

export function WorkspaceThreadsScreen({
  authToken,
  navigation,
  preview = null,
  route,
}: ThreadsScreenProps) {
  const { deviceId, projectId } = route.params;
  const { error, phase, projects } = useWorkspaceRouteState(authToken, deviceId, preview);
  const project = useMemo(() => projects.find((entry) => entry.id === projectId) || null, [projectId, projects]);
  const [creatingThread, setCreatingThread] = useState(false);
  const [threadActionError, setThreadActionError] = useState<string | null>(null);

  function handleBackToProjects() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.replace("Projects", { deviceId });
  }

  async function handleCreateThread() {
    if (!project || creatingThread) {
      return;
    }

    setCreatingThread(true);
    setThreadActionError(null);

    try {
      const thread = await createWorkspaceThread({
        authToken,
        deviceId,
        projectId,
        preview,
      });

      navigation.push("Chat", { deviceId, projectId, threadId: thread.id });
    } catch (caught) {
      setThreadActionError(caught instanceof Error ? caught.message : "Failed to create the workspace thread.");
    } finally {
      setCreatingThread(false);
    }
  }

  if (phase === "connecting") {
    return <ConnectingWorkspaceView />;
  }

  if (phase === "error" || !project) {
    return (
      <View style={styles.stateRoot}>
        <CenteredStatus
          description={error || "The selected project could not be found for this device."}
          title="Thread list unavailable"
        />
        <View style={styles.stateActions}>
          <Button label="Back to Projects" onPress={handleBackToProjects} />
        </View>
      </View>
    );
  }

  return (
    <ThreadListView
      creatingThread={creatingThread}
      error={threadActionError}
      onBack={handleBackToProjects}
      onCreateThread={() => {
        void handleCreateThread();
      }}
      onOpenThread={(threadId) => navigation.push("Chat", { deviceId, projectId, threadId })}
      project={project}
    />
  );
}

export function WorkspaceChatScreen({
  authToken,
  authUserName,
  navigation,
  preview = null,
  route,
}: ChatScreenProps) {
  const { deviceId, projectId, threadId } = route.params;
  const { device, error: workspaceError, modelOptions, phase, projects } = useWorkspaceRouteState(authToken, deviceId, preview);
  const {
    activeSheet,
    draft,
    handleCancelUserInputRequest,
    handleComposerUpdate,
    handleSend,
    handleSubmitUserInputRequest,
    handleUndoTurn,
    loadingMessages,
    messageError,
    project,
    respondingRequestId,
    setActiveSheet,
    setDraft,
    setReloadNonce,
    stoppingThread,
    submittingMessage,
    thread,
    threadSnapshot,
    undoingTurnRunId,
    updatingControl,
  } = useWorkspaceChatController({
    authToken,
    authUserName,
    deviceId,
    phase,
    preview,
    projectId,
    projects,
    threadId,
  });

  function handleBackToThreads() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.replace("Threads", { deviceId, projectId });
  }

  if (phase === "connecting") {
    return <ConnectingWorkspaceView />;
  }

  if (phase === "error" || !project || !thread) {
    return (
      <View style={styles.stateRoot}>
        <CenteredStatus
          description={workspaceError || "The selected thread could not be opened."}
          title="Chat unavailable"
        />
        <View style={styles.stateActions}>
          <Button label="Retry Thread" onPress={() => setReloadNonce((value) => value + 1)} />
          <Button label="Back to Threads" onPress={handleBackToThreads} tone="secondary" />
        </View>
      </View>
    );
  }

  return (
    <ChatView
      activeSheet={activeSheet}
      authToken={authToken}
      authUserName={authUserName}
      deviceId={deviceId}
      deviceName={device?.displayName || "Workspace"}
      draft={draft}
      error={messageError}
      loadingMessages={loadingMessages}
      messages={threadSnapshot.messages}
      modelOptions={modelOptions}
      onBack={handleBackToThreads}
      onCancelUserInputRequest={() => {
        void handleCancelUserInputRequest();
      }}
      onChangeAccess={(value) => {
        void handleComposerUpdate("access", { permissionMode: value });
      }}
      onChangeDraft={setDraft}
      onChangeEffort={(value) => {
        void handleComposerUpdate("effort", { reasoningEffortOverride: value });
      }}
      onChangeModel={(value) => {
        void handleComposerUpdate("model", { modelOverride: value });
      }}
      onChangeSheet={setActiveSheet}
      onOpenAttachmentPicker={() => {
        Alert.alert("준비 중", "파일 업로드 피커는 다음 단계에서 네이티브로 연결합니다.");
      }}
      onSend={() => {
        void handleSend();
      }}
      onSubmitUserInputRequest={(requestId, answers) => {
        void handleSubmitUserInputRequest(requestId, answers);
      }}
      onTogglePlanMode={() => {
        void handleComposerUpdate("plan", {
          defaultMode: thread.composerSettings.defaultMode === "plan" ? "default" : "plan",
        });
      }}
      onUndoTurn={(turnRunId) => {
        void handleUndoTurn(turnRunId);
      }}
      preview={preview}
      project={project}
      respondingUserInputRequestId={respondingRequestId}
      stoppingThread={stoppingThread}
      submittingMessage={submittingMessage}
      thread={thread}
      threadSnapshot={threadSnapshot}
      undoingTurnRunId={undoingTurnRunId}
      updatingControl={updatingControl}
    />
  );
}
