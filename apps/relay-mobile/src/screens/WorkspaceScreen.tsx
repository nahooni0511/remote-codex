import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AppUpdateApplyResult, AppUpdateStatus, RelayDeviceSummary } from "@remote-codex/contracts";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CenteredStatus } from "../components/CenteredStatus";
import { Button, Card, ErrorText } from "../components/ui";
import type { PreviewWorkspace } from "../lib/preview";
import { applyBlockedUpdate, fetchBlockedUpdateStatus } from "../lib/relay-api";
import {
  ensureWorkspaceSession,
  loadWorkspaceThreadMessages,
  peekWorkspaceSession,
  peekWorkspaceThreadMessages,
} from "../lib/workspace-session";
import type { AppStackParamList } from "../navigation/types";
import type { WorkspaceProject, WorkspaceThreadMessage } from "../types";

const palette = {
  background: "#faf9f7",
  surface: "#ffffff",
  surfaceMuted: "#f4f3f1",
  border: "rgba(227, 226, 224, 0.55)",
  borderSoft: "rgba(192, 200, 201, 0.18)",
  ink: "#002428",
  inkMuted: "#404849",
  inkSubtle: "#717879",
  deep: "#002428",
  deepSoft: "#0d3b3f",
  accentSurface: "rgba(0, 36, 40, 0.05)",
  accentMint: "#bfeaef",
  userBubble: "#0d3b3f",
  userBubbleText: "#ffffff",
  error: "#b24534",
};

type WorkspaceRoutePhase = "connecting" | "ready" | "blocked" | "error";

type ProjectsScreenProps = {
  authToken: string;
  fallbackDeviceId: string | null;
  navigation: NativeStackNavigationProp<AppStackParamList, "Projects">;
  onExitDevice: () => Promise<void>;
  onSignOut: () => void | Promise<void>;
  preview?: PreviewWorkspace | null;
  route: RouteProp<AppStackParamList, "Projects">;
};

type ThreadsScreenProps = {
  authToken: string;
  navigation: NativeStackNavigationProp<AppStackParamList, "Threads">;
  onSignOut: () => void | Promise<void>;
  preview?: PreviewWorkspace | null;
  route: RouteProp<AppStackParamList, "Threads">;
};

type ChatScreenProps = {
  authToken: string;
  navigation: NativeStackNavigationProp<AppStackParamList, "Chat">;
  onSignOut: () => void | Promise<void>;
  preview?: PreviewWorkspace | null;
  route: RouteProp<AppStackParamList, "Chat">;
};

function resolveWorkspacePhase(device: RelayDeviceSummary | null, error: string | null) {
  if (error) {
    return "error" as const;
  }

  if (device?.blockedReason) {
    return "blocked" as const;
  }

  return "ready" as const;
}

function useWorkspaceRouteState(authToken: string, deviceId: string | null, preview: PreviewWorkspace | null = null) {
  const cached = deviceId ? peekWorkspaceSession(deviceId, preview) : null;
  const [device, setDevice] = useState<RelayDeviceSummary | null>(cached?.device ?? null);
  const [projects, setProjects] = useState<WorkspaceProject[]>(cached?.projects ?? []);
  const [error, setError] = useState<string | null>(cached?.error ?? (deviceId ? null : "No device selected."));
  const [phase, setPhase] = useState<WorkspaceRoutePhase>(
    deviceId ? (cached ? resolveWorkspacePhase(cached.device, cached.error) : "connecting") : "error",
  );
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    setReloadNonce(0);
  }, [deviceId]);

  useEffect(() => {
    let cancelled = false;

    if (!deviceId) {
      setDevice(null);
      setProjects([]);
      setError("No device selected.");
      setPhase("error");
      return () => {
        cancelled = true;
      };
    }

    const nextCached = peekWorkspaceSession(deviceId, preview);
    if (nextCached) {
      setDevice(nextCached.device);
      setProjects(nextCached.projects);
      setError(nextCached.error);
      setPhase(resolveWorkspacePhase(nextCached.device, nextCached.error));
    } else {
      setDevice(null);
      setProjects([]);
      setError(null);
      setPhase("connecting");
    }

    void ensureWorkspaceSession({
      authToken,
      deviceId,
      preview,
      forceRefresh: reloadNonce > 0,
    })
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        setDevice(snapshot.device);
        setProjects(snapshot.projects);
        setError(snapshot.error);
        setPhase(resolveWorkspacePhase(snapshot.device, snapshot.error));
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }

        setDevice(null);
        setProjects([]);
        setError(caught instanceof Error ? caught.message : "The selected device could not be opened.");
        setPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, deviceId, preview, reloadNonce]);

  return {
    device,
    error,
    phase,
    projects,
    retry: () => setReloadNonce((value) => value + 1),
  };
}

const projectIcons: Array<keyof typeof MaterialCommunityIcons.glyphMap> = [
  "source-branch",
  "shield-half-full",
  "console-line",
  "graphql",
  "database",
];

function getProjectIcon(index: number): keyof typeof MaterialCommunityIcons.glyphMap {
  return projectIcons[index % projectIcons.length];
}

function MessageCard({ message }: { message: WorkspaceThreadMessage }) {
  const role = message.role.toLowerCase();
  const isUser = role === "user";
  const isSystem = role === "system";

  return (
    <View style={[styles.messageCard, isUser && styles.messageCardUser, isSystem && styles.messageCardSystem]}>
      <Text style={[styles.messageRole, isUser && styles.messageRoleUser]}>{message.role}</Text>
      <Text style={[styles.messageContent, isUser && styles.messageContentUser]}>{message.content}</Text>
    </View>
  );
}

function WorkspaceHeaderButton({
  icon,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.headerButton}>
      <Ionicons color={palette.deepSoft} name={icon} size={22} />
    </Pressable>
  );
}

function WorkspaceShell({
  header,
  children,
  floatingAction,
}: {
  header: ReactNode;
  children: ReactNode;
  floatingAction?: ReactNode;
}) {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <View style={styles.shell}>
          {header}
          {children}
          {floatingAction}
        </View>
      </SafeAreaView>
    </View>
  );
}

function ProjectListView({
  deviceName,
  projects,
  onBack,
  onOpenProject,
  onSignOut,
  error,
}: {
  deviceName: string;
  projects: WorkspaceProject[];
  onBack: () => void;
  onOpenProject: (projectId: number) => void;
  onSignOut: () => void;
  error: string | null;
}) {
  return (
    <WorkspaceShell
      floatingAction={
        <View pointerEvents="none" style={styles.fab}>
          <Ionicons color="#ffffff" name="add" size={24} />
        </View>
      }
      header={
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <WorkspaceHeaderButton icon="arrow-back" onPress={onBack} />
            <View style={styles.topBarCopy}>
              <Text style={styles.eyebrow}>Active Device</Text>
              <Text numberOfLines={1} style={styles.topBarTitle}>
                {deviceName}
              </Text>
            </View>
          </View>
          <WorkspaceHeaderButton icon="settings-outline" onPress={onSignOut} />
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.projectListContent} showsVerticalScrollIndicator={false}>
        {projects.map((project, index) => (
          <Pressable key={project.id} onPress={() => onOpenProject(project.id)} style={styles.projectCard}>
            <View style={styles.projectLead}>
              <View style={styles.projectIconShell}>
                <MaterialCommunityIcons color={palette.deepSoft} name={getProjectIcon(index)} size={20} />
              </View>
              <View style={styles.projectCopy}>
                <Text numberOfLines={1} style={styles.projectTitle}>
                  {project.name}
                </Text>
                <Text numberOfLines={1} style={styles.projectPath}>
                  {project.folderPath}
                </Text>
              </View>
            </View>
            <Ionicons color={palette.inkSubtle} name="chevron-forward" size={16} />
          </Pressable>
        ))}

        {!projects.length ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>No projects</Text>
            <Text style={styles.emptyStateText}>This device did not return any workspace projects.</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      </ScrollView>
    </WorkspaceShell>
  );
}

function ThreadListView({
  project,
  onBack,
  onOpenThread,
  onSignOut,
  openingThreadId,
  error,
}: {
  project: WorkspaceProject;
  onBack: () => void;
  onOpenThread: (threadId: number) => void;
  onSignOut: () => void;
  openingThreadId: number | null;
  error: string | null;
}) {
  return (
    <WorkspaceShell
      header={
        <View style={styles.topBarThread}>
          <View style={styles.topBarLeft}>
            <WorkspaceHeaderButton icon="arrow-back" onPress={onBack} />
            <View style={styles.topBarCopy}>
              <Text numberOfLines={1} style={styles.topBarTitle}>
                {project.name}
              </Text>
              <Text style={styles.eyebrow}>Thread List • Minimal View</Text>
            </View>
          </View>
          <WorkspaceHeaderButton icon="settings-outline" onPress={onSignOut} />
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.threadListContent} showsVerticalScrollIndicator={false}>
        {project.threads.map((thread) => (
          <Pressable key={thread.id} onPress={() => onOpenThread(thread.id)} style={styles.threadCard}>
            <Text numberOfLines={2} style={styles.threadCardTitle}>
              {thread.title}
            </Text>
            {openingThreadId === thread.id ? (
              <ActivityIndicator color={palette.deepSoft} size="small" />
            ) : (
              <Ionicons color={palette.inkSubtle} name="chevron-forward" size={14} />
            )}
          </Pressable>
        ))}

        {!project.threads.length ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>No threads</Text>
            <Text style={styles.emptyStateText}>This project does not have any threads yet.</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      </ScrollView>
    </WorkspaceShell>
  );
}

function ChatView({
  deviceName,
  project,
  threadTitle,
  messages,
  loadingMessages,
  onBack,
  onSignOut,
  error,
}: {
  deviceName: string;
  project: WorkspaceProject;
  threadTitle: string;
  messages: WorkspaceThreadMessage[];
  loadingMessages: boolean;
  onBack: () => void;
  onSignOut: () => void;
  error: string | null;
}) {
  const scrollViewRef = useRef<ScrollView | null>(null);

  function scrollToLatestMessage() {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated: false });
    });
  }

  useEffect(() => {
    if (loadingMessages) {
      return;
    }

    scrollToLatestMessage();
  }, [loadingMessages, messages.length, threadTitle]);

  return (
    <WorkspaceShell
      header={
        <View style={styles.topBarThread}>
          <View style={styles.topBarLeft}>
            <WorkspaceHeaderButton icon="arrow-back" onPress={onBack} />
            <View style={styles.topBarCopy}>
              <Text numberOfLines={1} style={styles.topBarTitle}>
                {threadTitle}
              </Text>
              <Text style={styles.eyebrow}>{project.name}</Text>
            </View>
          </View>
          <WorkspaceHeaderButton icon="settings-outline" onPress={onSignOut} />
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => {
          if (!loadingMessages) {
            scrollToLatestMessage();
          }
        }}
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.chatContextCard}>
          <Text style={styles.chatContextLabel}>Live Workspace</Text>
          <Text style={styles.chatContextValue}>{deviceName}</Text>
          <Text numberOfLines={1} style={styles.chatContextSubtext}>
            {project.folderPath}
          </Text>
        </View>

        {loadingMessages ? (
          <View style={styles.emptyStateCard}>
            <ActivityIndicator color={palette.deepSoft} size="small" />
            <Text style={styles.emptyStateText}>Loading thread messages…</Text>
          </View>
        ) : null}

        {!loadingMessages && !messages.length ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>No messages yet</Text>
            <Text style={styles.emptyStateText}>This thread is empty or could not return message history.</Text>
          </View>
        ) : null}

        {!loadingMessages ? messages.map((message) => <MessageCard key={message.id} message={message} />) : null}

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.chatComposerRail}>
        <ScrollView contentContainerStyle={styles.chatControlRow} horizontal showsHorizontalScrollIndicator={false}>
          {["Plan", "Model", "Effort", "Access"].map((chip) => (
            <View key={chip} style={styles.chatControlChip}>
              <Text style={styles.chatControlText}>{chip}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.chatComposer}>
          <Ionicons color={palette.inkSubtle} name="attach-outline" size={18} />
          <Text style={styles.chatComposerPlaceholder}>Reply to this thread…</Text>
          <View style={styles.chatSendButton}>
            <Ionicons color="#ffffff" name="arrow-forward" size={14} />
          </View>
        </View>
      </View>
    </WorkspaceShell>
  );
}

function WorkspaceBlockedState({
  authToken,
  device,
  onBack,
  retry,
}: {
  authToken: string;
  device: RelayDeviceSummary | null;
  onBack: () => void;
  retry: () => void;
}) {
  const [status, setStatus] = useState<AppUpdateStatus | AppUpdateApplyResult | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <View style={styles.stateRoot}>
      <CenteredStatus
        description={device?.blockedReason?.message || "This device requires a newer local runtime."}
        title={device?.displayName || "Protocol Blocked"}
      />
      <View style={styles.stateActions}>
        <Card tone="muted">
          <Text style={styles.blockedTitle}>Protocol Blocked</Text>
          <Text style={styles.blockedText}>
            Check for a compatible update or apply the available update path on the remote device.
          </Text>
          <Button
            disabled={pending !== null || !device}
            label={pending === "check" ? "Checking..." : "Check Update"}
            onPress={() => {
              if (!device) {
                return;
              }

              setPending("check");
              setActionError(null);
              void fetchBlockedUpdateStatus(authToken, device.deviceId)
                .then((result) => {
                  setStatus(result);
                  retry();
                })
                .catch((caught: Error) => setActionError(caught.message))
                .finally(() => setPending(null));
            }}
          />
          <Button
            disabled={pending !== null || !device}
            label={pending === "apply" ? "Updating..." : "Apply Update"}
            onPress={() => {
              if (!device) {
                return;
              }

              setPending("apply");
              setActionError(null);
              void applyBlockedUpdate(authToken, device.deviceId)
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
  onSignOut,
  preview = null,
  route,
}: ProjectsScreenProps) {
  const deviceId = route.params?.deviceId ?? fallbackDeviceId;
  const { device, error, phase, projects, retry } = useWorkspaceRouteState(authToken, deviceId, preview);

  if (!deviceId) {
    return (
      <View style={styles.stateRoot}>
        <CenteredStatus description="No device was selected for this workspace." title="Workspace unavailable" />
        <View style={styles.stateActions}>
          <Button
            label="Back to Devices"
            onPress={() => {
              navigation.reset({ index: 0, routes: [{ name: "Devices" }] });
            }}
          />
        </View>
      </View>
    );
  }

  if (phase === "connecting") {
    return (
      <CenteredStatus
        description="Fetching a connect token and loading project metadata."
        loading
        title="Connecting workspace"
      />
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.stateRoot}>
        <CenteredStatus description={error || "The selected device could not be opened."} title="Workspace unavailable" />
        <View style={styles.stateActions}>
          <Button label="Retry Connection" onPress={retry} />
          <Button
            label="Back to Devices"
            onPress={() => {
              void onExitDevice().then(() => navigation.reset({ index: 0, routes: [{ name: "Devices" }] }));
            }}
            tone="secondary"
          />
        </View>
      </View>
    );
  }

  if (phase === "blocked") {
    return (
      <WorkspaceBlockedState
        authToken={authToken}
        device={device}
        onBack={() => {
          void onExitDevice().then(() => navigation.reset({ index: 0, routes: [{ name: "Devices" }] }));
        }}
        retry={retry}
      />
    );
  }

  return (
    <ProjectListView
      deviceName={device?.displayName || "Workspace"}
      error={error}
      onBack={() => {
        void onExitDevice().then(() => navigation.reset({ index: 0, routes: [{ name: "Devices" }] }));
      }}
      onOpenProject={(projectId) => navigation.push("Threads", { deviceId, projectId })}
      onSignOut={() => void onSignOut()}
      projects={projects}
    />
  );
}

export function WorkspaceThreadsScreen({
  authToken,
  navigation,
  onSignOut,
  preview = null,
  route,
}: ThreadsScreenProps) {
  const { deviceId, projectId } = route.params;
  const { error, phase, projects } = useWorkspaceRouteState(authToken, deviceId, preview);
  const project = useMemo(() => projects.find((entry) => entry.id === projectId) || null, [projectId, projects]);

  if (phase === "connecting") {
    return (
      <CenteredStatus
        description="Loading projects for the selected device."
        loading
        title="Preparing thread list"
      />
    );
  }

  if (phase === "error" || !project) {
    return (
      <View style={styles.stateRoot}>
        <CenteredStatus
          description={error || "The selected project could not be found for this device."}
          title="Thread list unavailable"
        />
        <View style={styles.stateActions}>
          <Button label="Back to Projects" onPress={() => navigation.replace("Projects", { deviceId })} />
        </View>
      </View>
    );
  }

  return (
    <ThreadListView
      error={null}
      onBack={() => {
        if (navigation.canGoBack()) {
          navigation.goBack();
          return;
        }

        navigation.replace("Projects", { deviceId });
      }}
      onOpenThread={(threadId) => navigation.push("Chat", { deviceId, projectId, threadId })}
      onSignOut={() => void onSignOut()}
      openingThreadId={null}
      project={project}
    />
  );
}

export function WorkspaceChatScreen({
  authToken,
  navigation,
  onSignOut,
  preview = null,
  route,
}: ChatScreenProps) {
  const { deviceId, projectId, threadId } = route.params;
  const { device, error: workspaceError, phase, projects } = useWorkspaceRouteState(authToken, deviceId, preview);
  const project = useMemo(() => projects.find((entry) => entry.id === projectId) || null, [projectId, projects]);
  const thread = useMemo(() => project?.threads.find((entry) => entry.id === threadId) || null, [project, threadId]);
  const [messages, setMessages] = useState<WorkspaceThreadMessage[]>(
    peekWorkspaceThreadMessages(deviceId, threadId, preview) || [],
  );
  const [loadingMessages, setLoadingMessages] = useState(messages.length === 0);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cachedMessages = peekWorkspaceThreadMessages(deviceId, threadId, preview);
    if (cachedMessages?.length) {
      setMessages(cachedMessages);
      setLoadingMessages(false);
      setMessageError(null);
    } else {
      setMessages([]);
      setLoadingMessages(true);
      setMessageError(null);
    }

    if (phase !== "ready" || !project || !thread) {
      return () => {
        cancelled = true;
      };
    }

    void loadWorkspaceThreadMessages({
      authToken,
      deviceId,
      threadId,
      preview,
      forceRefresh: reloadNonce > 0,
    })
      .then((nextMessages) => {
        if (cancelled) {
          return;
        }

        setMessages(nextMessages);
        setLoadingMessages(false);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }

        setLoadingMessages(false);
        setMessageError(caught instanceof Error ? caught.message : "Failed to load thread messages.");
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, deviceId, phase, preview, project, reloadNonce, thread, threadId]);

  if (phase === "connecting") {
    return (
      <CenteredStatus
        description="Restoring the device workspace before opening the thread."
        loading
        title="Opening thread"
      />
    );
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
          <Button label="Back to Threads" onPress={() => navigation.replace("Threads", { deviceId, projectId })} tone="secondary" />
        </View>
      </View>
    );
  }

  return (
    <ChatView
      deviceName={device?.displayName || "Workspace"}
      error={messageError}
      loadingMessages={loadingMessages}
      messages={messages}
      onBack={() => {
        if (navigation.canGoBack()) {
          navigation.goBack();
          return;
        }

        navigation.replace("Threads", { deviceId, projectId });
      }}
      onSignOut={() => void onSignOut()}
      project={project}
      threadTitle={thread.title}
    />
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
  shell: {
    flex: 1,
    backgroundColor: palette.background,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: "rgba(250, 249, 247, 0.88)",
  },
  topBarThread: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 17,
    backgroundColor: "rgba(250, 249, 247, 0.88)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(227, 226, 224, 0.3)",
  },
  topBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flex: 1,
  },
  topBarCopy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    color: palette.inkMuted,
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  topBarTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.45,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  projectListContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 140,
    gap: 8,
  },
  projectCard: {
    borderRadius: 32,
    backgroundColor: palette.surface,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: palette.borderSoft,
  },
  projectLead: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  projectIconShell: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: palette.accentSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  projectCopy: {
    flex: 1,
    gap: 1,
  },
  projectTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  projectPath: {
    color: palette.inkSubtle,
    fontSize: 11,
    lineHeight: 17,
  },
  fab: {
    position: "absolute",
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: palette.deepSoft,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  threadListContent: {
    width: "100%",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
    gap: 4,
  },
  threadCard: {
    minHeight: 52,
    borderRadius: 6,
    backgroundColor: palette.surfaceMuted,
    paddingLeft: 24,
    paddingRight: 20,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  threadCardTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  chatContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    gap: 12,
  },
  chatContextCard: {
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    padding: 18,
    gap: 4,
  },
  chatContextLabel: {
    color: palette.inkSubtle,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  chatContextValue: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
  },
  chatContextSubtext: {
    color: palette.inkSubtle,
    fontSize: 12,
    lineHeight: 18,
  },
  messageCard: {
    maxWidth: "92%",
    borderRadius: 22,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  messageCardUser: {
    alignSelf: "flex-end",
    backgroundColor: palette.userBubble,
    borderColor: palette.userBubble,
  },
  messageCardSystem: {
    backgroundColor: "#f4f3f1",
  },
  messageRole: {
    color: palette.deepSoft,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  messageRoleUser: {
    color: "rgba(255,255,255,0.82)",
  },
  messageContent: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  messageContentUser: {
    color: palette.userBubbleText,
  },
  chatComposerRail: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(227, 226, 224, 0.4)",
    backgroundColor: "rgba(250, 249, 247, 0.96)",
  },
  chatControlRow: {
    gap: 8,
  },
  chatControlChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chatControlText: {
    color: palette.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  chatComposer: {
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  chatComposerPlaceholder: {
    flex: 1,
    color: palette.inkSubtle,
    fontSize: 14,
    lineHeight: 20,
  },
  chatSendButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: palette.deepSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStateCard: {
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStateTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  emptyStateText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  inlineError: {
    color: palette.error,
    fontSize: 14,
    lineHeight: 20,
  },
  stateRoot: {
    flex: 1,
    backgroundColor: palette.background,
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 18,
  },
  stateActions: {
    gap: 14,
  },
  blockedTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  blockedText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
  },
});
