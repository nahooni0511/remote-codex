import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { renderEventForChannel } from "@remote-codex/client-core";
import type {
  AppUpdateApplyResult,
  AppUpdateStatus,
  ComposerAttachmentRecord,
  MessageRecord,
  RealtimeEvent,
  RelayDeviceSummary,
  ThreadMode,
  ThreadStreamRealtimeEvent,
  TurnSummaryPayload,
  UserInputAnswers,
  UserInputQuestion,
  UserInputRequestPayload,
} from "@remote-codex/contracts";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GiftedChat, type IMessage, type InputToolbarProps, type MessageProps } from "react-native-gifted-chat";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { CenteredStatus } from "../components/CenteredStatus";
import { RichText } from "../components/RichText";
import { Button, Card, ErrorText } from "../components/ui";
import type { PreviewWorkspace } from "../lib/preview";
import { applyBlockedUpdate, fetchBlockedUpdateStatus } from "../lib/relay-api";
import {
  ensureWorkspaceSession,
  fetchWorkspaceMessageAttachment,
  interruptWorkspaceThread,
  loadWorkspaceThreadMessages,
  peekWorkspaceSession,
  peekWorkspaceThreadSnapshot,
  respondWorkspaceUserInputRequest,
  sendWorkspaceThreadMessage,
  subscribeWorkspaceRealtime,
  undoWorkspaceThreadTurn,
  updateWorkspaceComposerSettings,
} from "../lib/workspace-session";
import type { AppStackParamList } from "../navigation/types";
import type {
  WorkspaceAttachmentPreview,
  WorkspaceModelOption,
  WorkspaceProject,
  WorkspaceThread,
  WorkspaceThreadMessage,
  WorkspaceThreadSnapshot,
} from "../types";

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
  userBubble: "#174447",
  userBubbleText: "#ffffff",
  error: "#b24534",
  chatCanvas: "#0a0f10",
  chatSurface: "#12191b",
  chatSurfaceSoft: "#171f22",
  chatBorder: "rgba(255, 255, 255, 0.08)",
  chatText: "#f5f8f7",
  chatMuted: "#a2acab",
  chatSubtle: "#7d8684",
  chatAccent: "#87d8c3",
  chatError: "#ffb09a",
};

type WorkspaceRoutePhase = "connecting" | "ready" | "blocked" | "error";
type ComposerSheet = "model" | "effort" | "access" | null;
type GiftedRelayMessage =
  | (IMessage & {
      kind: "history";
      record: WorkspaceThreadMessage;
    })
  | (IMessage & {
      kind: "live-plan" | "live-reasoning" | "live-assistant";
      liveText: string;
    });

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
  authUserName: string;
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

function mergeMessages(existing: MessageRecord[], incoming: MessageRecord[]) {
  const merged = [...existing, ...incoming];
  const byId = new Map<number, MessageRecord>();
  merged.forEach((message) => {
    byId.set(message.id, message);
  });
  return Array.from(byId.values()).sort((left, right) => left.id - right.id);
}

function toGiftedRelayMessage(message: WorkspaceThreadMessage): GiftedRelayMessage {
  return {
    _id: `message:${message.id}`,
    createdAt: 0,
    kind: "history",
    record: message,
    system: false,
    text: message.content || "",
    user: {
      _id: message.role === "user" ? "user" : message.payload?.kind === "turn_summary" ? "summary" : "codex",
      name: message.originActor || (message.role === "user" ? "You" : "Codex"),
    },
  };
}

function toGiftedLiveMessage(
  kind: Extract<GiftedRelayMessage["kind"], "live-plan" | "live-reasoning" | "live-assistant">,
  liveText: string,
): GiftedRelayMessage {
  return {
    _id: `stream:${kind}`,
    createdAt: 0,
    kind,
    liveText,
    system: false,
    text: liveText,
    user: {
      _id: kind === "live-assistant" ? "codex" : "system",
      name: "Codex",
    },
  };
}

function normalizeComparableText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/gu, " ").trim();
}

function normalizePersistedMessageText(message: WorkspaceThreadMessage): string {
  if (message.kind === "progress_event") {
    return normalizeComparableText(
      message.content.replace(/^Codex 진행:\s*/u, "").replace(/^Codex 진행\s*\n\s*/u, ""),
    );
  }

  if (message.kind === "plan_event") {
    return normalizeComparableText(message.content.replace(/^Codex plan\s*\n*/u, ""));
  }

  return normalizeComparableText(message.content);
}

function isDuplicateStreamText(
  streamText: string,
  persistedText: string,
  mode: "exact" | "prefix" = "exact",
): boolean {
  const nextStreamText = normalizeComparableText(streamText);
  const nextPersistedText = normalizeComparableText(persistedText);

  if (!nextStreamText || !nextPersistedText) {
    return false;
  }

  if (mode === "exact") {
    return nextStreamText === nextPersistedText;
  }

  return nextStreamText === nextPersistedText || nextPersistedText.startsWith(nextStreamText) || nextStreamText.startsWith(nextPersistedText);
}

function hasRecentMatchingMessage(
  messages: WorkspaceThreadMessage[],
  streamText: string,
  expectedKinds: WorkspaceThreadMessage["kind"][],
  mode: "exact" | "prefix" = "exact",
): boolean {
  const trailingMessages = messages.slice(-6);

  return trailingMessages.some((message) => {
    if (!expectedKinds.includes(message.kind)) {
      return false;
    }

    return isDuplicateStreamText(streamText, normalizePersistedMessageText(message), mode);
  });
}

function buildRenderableGiftedMessages(
  messages: WorkspaceThreadMessage[],
  liveStream: WorkspaceThreadSnapshot["liveStream"],
  running: boolean,
): GiftedRelayMessage[] {
  const historyMessages = messages.map(toGiftedRelayMessage);

  if (!liveStream || !running) {
    return historyMessages;
  }

  const syntheticMessages: GiftedRelayMessage[] = [];

  if (liveStream.planText && !hasRecentMatchingMessage(messages, liveStream.planText, ["plan_event"], "exact")) {
    syntheticMessages.push(toGiftedLiveMessage("live-plan", liveStream.planText));
  }

  if (liveStream.reasoningText && !hasRecentMatchingMessage(messages, liveStream.reasoningText, ["progress_event"], "exact")) {
    syntheticMessages.push(toGiftedLiveMessage("live-reasoning", liveStream.reasoningText));
  }

  const hasAssistantDuplicate =
    hasRecentMatchingMessage(messages, liveStream.assistantText, ["assistant_message"], "prefix") ||
    hasRecentMatchingMessage(messages, liveStream.assistantText, ["progress_event"], "exact");

  if (liveStream.assistantText && !hasAssistantDuplicate) {
    syntheticMessages.push(toGiftedLiveMessage("live-assistant", liveStream.assistantText));
  }

  return [...historyMessages, ...syntheticMessages];
}

function applyThreadStreamEvent(
  current: WorkspaceThreadSnapshot["liveStream"],
  event: ThreadStreamRealtimeEvent,
) {
  if (event.type === "clear") {
    return null;
  }

  const next = current
    ? { ...current }
    : {
        reasoningText: "",
        assistantText: "",
        planText: "",
      };

  if (event.type === "reasoning-delta") {
    next.reasoningText += event.text || "";
  } else if (event.type === "reasoning-complete") {
    next.reasoningText = event.text || "";
  } else if (event.type === "assistant-delta") {
    next.assistantText += event.text || "";
  } else if (event.type === "assistant-complete" && event.phase !== "final_answer") {
    next.assistantText = event.text || "";
  } else if (event.type === "plan-updated") {
    const lines: string[] = [];
    if (event.explanation) {
      lines.push(event.explanation);
    }
    if (Array.isArray(event.plan) && event.plan.length) {
      if (lines.length) {
        lines.push("");
      }
      event.plan.forEach((step) => {
        lines.push(`- [${step.status}] ${step.step}`);
      });
    }
    next.planText = lines.join("\n").trim();
  }

  return next.reasoningText || next.assistantText || next.planText ? next : null;
}

function shouldClearLiveStreamForMessages(messages: MessageRecord[], running: boolean) {
  if (!running && messages.length > 0) {
    return true;
  }

  return messages.some(
    (message) =>
      message.role === "assistant" ||
      message.payload?.kind === "turn_summary" ||
      message.payload?.kind === "user_input_request",
  );
}

function formatClockTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDurationMs(value: number | null | undefined): string {
  if (!value || value < 1000) {
    return "1초 미만";
  }

  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}초`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

function formatEffortLabel(effort: string | null | undefined): string {
  if (!effort) {
    return "자동";
  }

  if (effort === "minimal") {
    return "최소";
  }
  if (effort === "low") {
    return "낮음";
  }
  if (effort === "medium") {
    return "보통";
  }
  if (effort === "high") {
    return "높음";
  }
  if (effort === "xhigh") {
    return "매우 높음";
  }

  return effort;
}

function formatPermissionLabel(permission: WorkspaceThread["composerSettings"]["permissionMode"]) {
  return permission === "danger-full-access" ? "전체 액세스" : "기본권한";
}

function summarizeFileChange(file: TurnSummaryPayload["changedFiles"][number]) {
  if (file.isUntracked || file.status === "??") {
    return "추가";
  }
  if (file.status.includes("D")) {
    return "삭제";
  }
  if (file.status.includes("R")) {
    return "이동";
  }
  return "편집";
}

function formatFileDelta(file: TurnSummaryPayload["changedFiles"][number]) {
  const parts: string[] = [];
  if (file.insertions !== null) {
    parts.push(`+${file.insertions}`);
  }
  if (file.deletions !== null) {
    parts.push(`-${file.deletions}`);
  }
  return parts.join(" ");
}

function buildInitialSelections(request: UserInputRequestPayload) {
  return Object.fromEntries(
    request.questions.map((question) => {
      const submittedValue = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
      if (!submittedValue) {
        return [question.id, ""];
      }

      const matchesOption = question.options.some((option) => option.label === submittedValue);
      return [question.id, matchesOption ? submittedValue : "__other__"];
    }),
  ) as Record<string, string>;
}

function buildInitialOtherValues(request: UserInputRequestPayload) {
  return Object.fromEntries(
    request.questions.map((question) => {
      const submittedValue = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
      const matchesOption = question.options.some((option) => option.label === submittedValue);
      return [question.id, submittedValue && !matchesOption ? submittedValue : ""];
    }),
  ) as Record<string, string>;
}

function formatSubmittedAnswer(question: UserInputQuestion, request: UserInputRequestPayload) {
  const value = request.submittedAnswers?.[question.id]?.answers?.[0]?.trim() || "";
  return value || null;
}

function createEmptyThreadSnapshot(thread: WorkspaceThread | null): WorkspaceThreadSnapshot {
  return {
    thread,
    messages: [],
    hasMoreBefore: false,
    liveStream: null,
  };
}

function makeOptimisticUserMessage(threadId: number, content: string, authUserName: string): WorkspaceThreadMessage {
  return {
    id: -Date.now(),
    threadId,
    kind: "user_message",
    role: "user",
    content,
    originChannel: "local-ui",
    originActor: authUserName || "You",
    displayHints: {
      hideOrigin: false,
      accent: "default",
      localSenderName: authUserName || "You",
      telegramSenderName: null,
    },
    errorText: null,
    attachmentKind: null,
    attachmentMimeType: null,
    attachmentFilename: null,
    payload: null,
    createdAt: new Date().toISOString(),
  };
}

function useWorkspaceRouteState(authToken: string, deviceId: string | null, preview: PreviewWorkspace | null = null) {
  const cached = deviceId ? peekWorkspaceSession(deviceId, preview) : null;
  const [device, setDevice] = useState<RelayDeviceSummary | null>(cached?.device ?? null);
  const [projects, setProjects] = useState<WorkspaceProject[]>(cached?.projects ?? []);
  const [modelOptions, setModelOptions] = useState<WorkspaceModelOption[]>(cached?.modelOptions ?? []);
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
      setModelOptions([]);
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
      setModelOptions(nextCached.modelOptions);
      setError(nextCached.error);
      setPhase(resolveWorkspacePhase(nextCached.device, nextCached.error));
    } else {
      setDevice(null);
      setProjects([]);
      setModelOptions([]);
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
        setModelOptions(snapshot.modelOptions);
        setError(snapshot.error);
        setPhase(resolveWorkspacePhase(snapshot.device, snapshot.error));
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }

        setDevice(null);
        setProjects([]);
        setModelOptions([]);
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
    modelOptions,
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
              <Text style={styles.eyebrow}>Thread List</Text>
            </View>
          </View>
          <WorkspaceHeaderButton icon="settings-outline" onPress={onSignOut} />
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.threadListContent} showsVerticalScrollIndicator={false}>
        {project.threads.map((thread) => (
          <Pressable key={thread.id} onPress={() => onOpenThread(thread.id)} style={styles.threadCard}>
            <View style={styles.threadCardCopy}>
              <Text numberOfLines={2} style={styles.threadCardTitle}>
                {thread.title}
              </Text>
              <Text style={styles.threadCardMeta}>
                {thread.running ? "Codex 작업 중" : "Ready"} · {thread.effectiveModel || "자동"}
              </Text>
            </View>
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

function AttachmentChips({
  attachments,
  removable = false,
  onRemove,
}: {
  attachments: ComposerAttachmentRecord[];
  removable?: boolean;
  onRemove?: (attachmentId: string) => void;
}) {
  if (!attachments.length) {
    return null;
  }

  return (
    <View style={styles.attachmentChips}>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.attachmentChip}>
          <Ionicons color={palette.chatMuted} name="attach-outline" size={13} />
          <Text numberOfLines={1} style={styles.attachmentChipText}>
            {attachment.relativePath || attachment.name}
          </Text>
          {removable && onRemove ? (
            <Pressable onPress={() => onRemove(attachment.id)} style={styles.attachmentChipRemove}>
              <Ionicons color={palette.chatMuted} name="close" size={12} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function MessageAttachmentPreview({
  authToken,
  deviceId,
  message,
  preview,
}: {
  authToken: string;
  deviceId: string;
  message: WorkspaceThreadMessage;
  preview: PreviewWorkspace | null;
}) {
  const [attachment, setAttachment] = useState<WorkspaceAttachmentPreview | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!message.attachmentKind) {
      setAttachment(null);
      return () => {
        cancelled = true;
      };
    }

    void fetchWorkspaceMessageAttachment({
      authToken,
      deviceId,
      messageId: message.id,
      preview,
    })
      .then((nextAttachment) => {
        if (!cancelled) {
          setAttachment(nextAttachment);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAttachment(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, deviceId, message.attachmentKind, message.id, preview]);

  if (!message.attachmentKind) {
    return null;
  }

  if (attachment?.uri && attachment.kind === "image") {
    return <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />;
  }

  if (attachment?.uri) {
    return (
      <Pressable onPress={() => void Linking.openURL(attachment.uri!)} style={styles.attachmentLink}>
        <Ionicons color={palette.chatText} name="open-outline" size={15} />
        <Text style={styles.attachmentLinkText}>{message.attachmentFilename || attachment.fileName || "Open attachment"}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.attachmentFallback}>
      <Ionicons color={palette.chatMuted} name="document-outline" size={15} />
      <Text style={styles.attachmentFallbackText}>{message.attachmentFilename || "Attachment unavailable"}</Text>
    </View>
  );
}

function SummaryActionButton({
  label,
  onPress,
  disabled = false,
  tone = "secondary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "secondary" | "ghost" | "danger";
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.summaryActionButton,
        tone === "ghost"
          ? styles.summaryActionGhost
          : tone === "danger"
            ? styles.summaryActionDanger
            : styles.summaryActionSecondary,
        disabled && styles.summaryActionDisabled,
      ]}
    >
      <Text style={styles.summaryActionLabel}>{label}</Text>
    </Pressable>
  );
}

function TurnSummaryCard({
  summary,
  enabledUndo,
  undoing,
  onUndo,
}: {
  summary: TurnSummaryPayload;
  enabledUndo: boolean;
  undoing: boolean;
  onUndo: (turnRunId: number) => void;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryTitle}>
          {summary.changedFileCount > 0 ? `${summary.changedFileCount}개 파일 변경됨` : "Codex 작업 요약"}
        </Text>
        {enabledUndo ? (
          <SummaryActionButton
            disabled={undoing}
            label={undoing ? "실행취소 중..." : "실행취소"}
            onPress={() => onUndo(summary.turnRunId)}
          />
        ) : null}
      </View>

      <View style={styles.summaryMeta}>
        <Text style={styles.summaryMetaText}>{formatDurationMs(summary.durationMs)} 동안 작업</Text>
        {summary.exploredFilesCount ? <Text style={styles.summaryMetaText}>{summary.exploredFilesCount}개 파일 탐색</Text> : null}
        {summary.branch ? <Text style={styles.summaryMetaText}>{summary.branch}</Text> : null}
      </View>

      {summary.note ? <Text style={styles.summaryNote}>{summary.note}</Text> : null}

      {summary.changedFiles.length ? (
        <View style={styles.summaryFiles}>
          {summary.changedFiles.map((file) => {
            const delta = formatFileDelta(file);
            return (
              <View key={`${file.path}:${file.status}`} style={styles.summaryFileRow}>
                <View style={styles.summaryFileCopy}>
                  <Text numberOfLines={1} style={styles.summaryFileLabel}>
                    {summarizeFileChange(file)} {file.path}
                  </Text>
                </View>
                {delta ? <Text style={styles.summaryDelta}>{delta}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {!enabledUndo && summary.undoState === "undone" ? (
        <Text style={styles.summaryState}>실행취소됨</Text>
      ) : null}
      {!enabledUndo && summary.undoState === "blocked" ? (
        <Text style={styles.summaryState}>현재 상태에서는 실행취소할 수 없음</Text>
      ) : null}
    </View>
  );
}

function UserInputRequestCard({
  request,
  respondingRequestId,
  stopping,
  onSubmit,
  onCancel,
}: {
  request: UserInputRequestPayload;
  respondingRequestId: string | null;
  stopping: boolean;
  onSubmit: (requestId: string, answers: UserInputAnswers) => void;
  onCancel: (requestId: string) => void;
}) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>(() => buildInitialSelections(request));
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>(() => buildInitialOtherValues(request));
  const isLocked = request.status !== "pending";
  const isSubmitting = respondingRequestId === request.requestId;

  useEffect(() => {
    setSelectedAnswers(buildInitialSelections(request));
    setOtherAnswers(buildInitialOtherValues(request));
  }, [request]);

  const canSubmit =
    !isLocked &&
    request.questions.every((question) => {
      const selectedValue = selectedAnswers[question.id] || "";
      if (!selectedValue) {
        return false;
      }
      if (selectedValue === "__other__") {
        return Boolean(otherAnswers[question.id]?.trim());
      }
      return true;
    });

  return (
    <View style={styles.userInputCard}>
      <View style={styles.userInputHeader}>
        <Text style={styles.summaryTitle}>Codex가 선택을 요청했습니다</Text>
        <Text style={styles.userInputState}>
          {request.status === "resolved" ? "처리 완료" : request.status === "submitted" ? "제출됨" : "대기 중"}
        </Text>
      </View>

      <View style={styles.userInputQuestions}>
        {request.questions.map((question) => (
          <View key={question.id} style={styles.userInputQuestion}>
            {question.header ? <Text style={styles.userInputQuestionHeader}>{question.header}</Text> : null}
            <Text style={styles.userInputQuestionText}>{question.question}</Text>

            <View style={styles.userInputOptions}>
              {question.options.map((option) => {
                const selected = selectedAnswers[question.id] === option.label;
                return (
                  <Pressable
                    key={option.label}
                    disabled={isLocked || isSubmitting}
                    onPress={() =>
                      setSelectedAnswers((current) => ({
                        ...current,
                        [question.id]: option.label,
                      }))
                    }
                    style={[styles.userInputOption, selected && styles.userInputOptionSelected]}
                  >
                    <Text style={styles.userInputOptionLabel}>{option.label}</Text>
                    {option.description ? <Text style={styles.userInputOptionDescription}>{option.description}</Text> : null}
                  </Pressable>
                );
              })}

              {question.isOther ? (
                <View style={styles.userInputOtherWrap}>
                  <Pressable
                    disabled={isLocked || isSubmitting}
                    onPress={() =>
                      setSelectedAnswers((current) => ({
                        ...current,
                        [question.id]: "__other__",
                      }))
                    }
                    style={[
                      styles.userInputOption,
                      selectedAnswers[question.id] === "__other__" && styles.userInputOptionSelected,
                    ]}
                  >
                    <Text style={styles.userInputOptionLabel}>직접 입력</Text>
                  </Pressable>
                  {selectedAnswers[question.id] === "__other__" ? (
                    <TextInput
                      editable={!isLocked && !isSubmitting}
                      onChangeText={(value) =>
                        setOtherAnswers((current) => ({
                          ...current,
                          [question.id]: value,
                        }))
                      }
                      placeholder="직접 입력"
                      placeholderTextColor={palette.chatSubtle}
                      secureTextEntry={question.isSecret}
                      style={styles.userInputOtherInput}
                      value={otherAnswers[question.id] || ""}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>

            {request.status !== "pending" ? (
              <Text style={styles.userInputAnswerSummary}>
                선택: {formatSubmittedAnswer(question, request) || "응답 없음"}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {request.status === "pending" ? (
        <View style={styles.userInputActions}>
          <SummaryActionButton
            disabled={isSubmitting || stopping}
            label={stopping ? "취소 중..." : "취소"}
            onPress={() => onCancel(request.requestId)}
            tone="ghost"
          />
          <SummaryActionButton
            disabled={!canSubmit || isSubmitting || stopping}
            label={isSubmitting ? "제출 중..." : "선택 제출"}
            onPress={() => {
              const answers = Object.fromEntries(
                request.questions.map((question) => {
                  const selectedValue = selectedAnswers[question.id];
                  const answer =
                    selectedValue === "__other__" ? otherAnswers[question.id]?.trim() || "" : selectedValue;
                  return [
                    question.id,
                    {
                      answers: answer ? [answer] : [],
                    },
                  ];
                }),
              ) as UserInputAnswers;
              onSubmit(request.requestId, answers);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function MessageRow({
  authToken,
  authUserName,
  deviceId,
  latestUndoableTurnRunId,
  message,
  onCancelUserInputRequest,
  onSubmitUserInputRequest,
  onUndoTurn,
  preview,
  respondingUserInputRequestId,
  stoppingThread,
  undoingTurnRunId,
}: {
  authToken: string;
  authUserName: string;
  deviceId: string;
  latestUndoableTurnRunId: number | null;
  message: WorkspaceThreadMessage;
  onCancelUserInputRequest: (requestId: string) => void;
  onSubmitUserInputRequest: (requestId: string, answers: UserInputAnswers) => void;
  onUndoTurn: (turnRunId: number) => void;
  preview: PreviewWorkspace | null;
  respondingUserInputRequestId: string | null;
  stoppingThread: boolean;
  undoingTurnRunId: number | null;
}) {
  const rendered = renderEventForChannel("local-ui", message, authUserName);
  const isUser = message.role === "user";
  const attachmentPayload = message.payload?.kind === "attachments" ? message.payload.attachments : [];

  if (message.payload?.kind === "turn_summary") {
    const summary = message.payload.summary;
    const enabledUndo =
      summary.undoAvailable &&
      summary.undoState === "available" &&
      latestUndoableTurnRunId === summary.turnRunId;

    return (
      <View style={styles.summaryRow}>
        <TurnSummaryCard
          enabledUndo={enabledUndo}
          onUndo={onUndoTurn}
          summary={summary}
          undoing={undoingTurnRunId === summary.turnRunId}
        />
      </View>
    );
  }

  if (message.payload?.kind === "user_input_request") {
    return (
      <View style={styles.summaryRow}>
        <UserInputRequestCard
          onCancel={onCancelUserInputRequest}
          onSubmit={onSubmitUserInputRequest}
          request={message.payload.request}
          respondingRequestId={respondingUserInputRequestId}
          stopping={stoppingThread}
        />
      </View>
    );
  }

  if (rendered.isSystem) {
    return (
      <View style={styles.codexEntry}>
        <View style={styles.codexBody}>
          <Text style={styles.systemAccentLabel}>
            {rendered.isError ? "Error" : rendered.isCron ? "Cron" : rendered.isProgress ? "Progress" : "System"}
          </Text>
          {rendered.content ? <RichText text={rendered.content} tone="muted" /> : null}
          <MessageAttachmentPreview authToken={authToken} deviceId={deviceId} message={message} preview={preview} />
        </View>
      </View>
    );
  }

  if (!isUser) {
    return (
      <View style={styles.codexEntry}>
        <View style={styles.codexBody}>
          {rendered.showSender ? <Text style={styles.caption}>{rendered.senderLabel}</Text> : null}
          {rendered.content ? <RichText text={rendered.content} tone="codex" /> : null}
          <AttachmentChips attachments={attachmentPayload} />
          <MessageAttachmentPreview authToken={authToken} deviceId={deviceId} message={message} preview={preview} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.userEntry}>
      <View style={styles.userBubbleWrap}>
        <View style={styles.userBubble}>
          {rendered.showSender ? <Text style={styles.userCaption}>{rendered.senderLabel}</Text> : null}
          {rendered.content ? <RichText text={rendered.content} tone="inverse" /> : null}
          <AttachmentChips attachments={attachmentPayload} />
          <MessageAttachmentPreview authToken={authToken} deviceId={deviceId} message={message} preview={preview} />
        </View>
        <Text style={styles.timestamp}>{formatClockTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}

function LiveMessageRow({
  kind,
  text,
}: {
  kind: Extract<GiftedRelayMessage["kind"], "live-plan" | "live-reasoning" | "live-assistant">;
  text: string;
}) {
  if (kind === "live-assistant") {
    return (
      <View style={styles.codexEntry}>
        <View style={styles.codexBody}>
          <RichText text={text} tone="codex" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.codexEntry}>
      <View style={styles.codexBody}>
        <Text style={styles.systemAccentLabel}>{kind === "live-plan" ? "Plan" : "Thinking"}</Text>
        <RichText text={text} tone="muted" />
      </View>
    </View>
  );
}

function ComposerChip({
  active = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.controlChip, active && styles.controlChipActive, disabled && styles.controlChipDisabled]}
    >
      <Ionicons color={active ? palette.chatText : palette.chatMuted} name={icon} size={14} />
      <Text numberOfLines={1} style={[styles.controlChipText, active && styles.controlChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function GiftedComposerToolbar({
  activeSheet,
  bottomInset,
  draft,
  effortValue,
  keyboardVisible,
  onChangeDraft,
  onChangeSheet,
  onOpenAttachmentPicker,
  onSend,
  onTogglePlanMode,
  permissionLabel,
  selectedModelLabel,
  selectedModelReasoning,
  stoppingThread,
  submittingMessage,
  thread,
  updatingControl,
}: {
  activeSheet: ComposerSheet;
  bottomInset: number;
  draft: string;
  effortValue: string;
  keyboardVisible: boolean;
  onChangeDraft: (value: string) => void;
  onChangeSheet: (value: ComposerSheet) => void;
  onOpenAttachmentPicker: () => void;
  onSend: () => void;
  onTogglePlanMode: () => void;
  permissionLabel: string;
  selectedModelLabel: string;
  selectedModelReasoning: string | null | undefined;
  stoppingThread: boolean;
  submittingMessage: boolean;
  thread: WorkspaceThread;
  updatingControl: string | null;
}) {
  const sendDisabled = stoppingThread || (submittingMessage && !thread.running) || (!thread.running && !draft.trim());
  const composerBottomPadding = keyboardVisible ? 8 : Math.max(bottomInset, 10) + 4;

  return (
    <View
      style={[
        styles.chatComposerRail,
        {
          paddingBottom: composerBottomPadding,
        },
      ]}
    >
      <ScrollView contentContainerStyle={styles.chatControlRow} horizontal showsHorizontalScrollIndicator={false}>
        <ComposerChip
          disabled={submittingMessage || stoppingThread}
          icon="attach-outline"
          label="파일 업로드"
          onPress={onOpenAttachmentPicker}
        />
        <ComposerChip
          active={thread.composerSettings.defaultMode === "plan"}
          disabled={updatingControl === "plan"}
          icon="git-branch-outline"
          label={thread.composerSettings.defaultMode === "plan" ? "플랜 ON" : "플랜 OFF"}
          onPress={onTogglePlanMode}
        />
        <ComposerChip
          active={activeSheet === "model"}
          disabled={updatingControl === "model"}
          icon="sparkles-outline"
          label={selectedModelLabel}
          onPress={() => onChangeSheet("model")}
        />
        <ComposerChip
          active={activeSheet === "effort"}
          disabled={updatingControl === "effort"}
          icon="flash-outline"
          label={
            effortValue === "__default__"
              ? `Effort ${formatEffortLabel(thread.effectiveReasoningEffort || selectedModelReasoning)}`
              : `Effort ${formatEffortLabel(thread.composerSettings.reasoningEffortOverride)}`
          }
          onPress={() => onChangeSheet("effort")}
        />
        <ComposerChip
          active={activeSheet === "access"}
          disabled={updatingControl === "access"}
          icon="shield-outline"
          label={permissionLabel}
          onPress={() => onChangeSheet("access")}
        />
      </ScrollView>

      <View style={styles.chatComposer}>
        <TextInput
          multiline
          onChangeText={onChangeDraft}
          placeholder="후속 변경 사항을 부탁하세요"
          placeholderTextColor={palette.chatSubtle}
          style={styles.chatComposerInput}
          value={draft}
        />
        <Pressable
          disabled={sendDisabled}
          onPress={onSend}
          style={[styles.chatSendButton, sendDisabled && styles.chatSendButtonDisabled]}
        >
          <Ionicons color="#ffffff" name={thread.running ? "stop" : "arrow-forward"} size={16} />
        </Pressable>
      </View>
    </View>
  );
}

function ComposerSheetModal({
  selectedValue,
  title,
  visible,
  options,
  onClose,
  onSelect,
}: {
  selectedValue: string;
  title: string;
  visible: boolean;
  options: Array<{ label: string; value: string; description?: string }>;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.sheetBackdrop}>
        <Pressable onPress={() => undefined} style={styles.sheetCard}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <View style={styles.sheetOptions}>
            {options.map((option) => {
              const selected = option.value === selectedValue;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onSelect(option.value);
                    onClose();
                  }}
                  style={[styles.sheetOption, selected && styles.sheetOptionSelected]}
                >
                  <View style={styles.sheetOptionCopy}>
                    <Text style={styles.sheetOptionLabel}>{option.label}</Text>
                    {option.description ? <Text style={styles.sheetOptionDescription}>{option.description}</Text> : null}
                  </View>
                  {selected ? <Ionicons color={palette.chatAccent} name="checkmark" size={18} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChatView({
  activeSheet,
  authToken,
  authUserName,
  deviceId,
  deviceName,
  draft,
  error,
  loadingMessages,
  messages,
  modelOptions,
  onBack,
  onCancelUserInputRequest,
  onChangeDraft,
  onChangeSheet,
  onChangeAccess,
  onChangeEffort,
  onChangeModel,
  onOpenAttachmentPicker,
  onSend,
  onSignOut,
  onSubmitUserInputRequest,
  onTogglePlanMode,
  onUndoTurn,
  preview,
  project,
  respondingUserInputRequestId,
  stoppingThread,
  submittingMessage,
  thread,
  threadSnapshot,
  undoingTurnRunId,
  updatingControl,
}: {
  activeSheet: ComposerSheet;
  authToken: string;
  authUserName: string;
  deviceId: string;
  deviceName: string;
  draft: string;
  error: string | null;
  loadingMessages: boolean;
  messages: WorkspaceThreadMessage[];
  modelOptions: WorkspaceModelOption[];
  onBack: () => void;
  onCancelUserInputRequest: (requestId: string) => void;
  onChangeDraft: (value: string) => void;
  onChangeSheet: (value: ComposerSheet) => void;
  onChangeAccess: (value: WorkspaceThread["composerSettings"]["permissionMode"]) => void;
  onChangeEffort: (value: string | null) => void;
  onChangeModel: (value: string | null) => void;
  onOpenAttachmentPicker: () => void;
  onSend: () => void;
  onSignOut: () => void;
  onSubmitUserInputRequest: (requestId: string, answers: UserInputAnswers) => void;
  onTogglePlanMode: () => void;
  onUndoTurn: (turnRunId: number) => void;
  preview: PreviewWorkspace | null;
  project: WorkspaceProject;
  respondingUserInputRequestId: string | null;
  stoppingThread: boolean;
  submittingMessage: boolean;
  thread: WorkspaceThread;
  threadSnapshot: WorkspaceThreadSnapshot;
  undoingTurnRunId: number | null;
  updatingControl: string | null;
}) {
  const insets = useSafeAreaInsets();
  const messagesContainerRef = useRef<any>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const latestUndoableTurnRunId = useMemo(() => {
    const summaries = messages
      .map((message) => message.payload)
      .filter((payload): payload is { kind: "turn_summary"; summary: TurnSummaryPayload } => payload?.kind === "turn_summary")
      .map((payload) => payload.summary)
      .filter((summary) => summary.undoAvailable && summary.undoState === "available");

    return summaries.length ? summaries[summaries.length - 1].turnRunId : null;
  }, [messages]);

  const selectedModelId = thread.composerSettings.modelOverride || thread.effectiveModel || modelOptions[0]?.value || "";
  const selectedModel = modelOptions.find((entry) => entry.value === selectedModelId) || modelOptions[0] || null;
  const effortValue = thread.composerSettings.reasoningEffortOverride || "__default__";
  const modelSheetValue = thread.composerSettings.modelOverride || "__default__";
  const permissionValue = thread.composerSettings.permissionMode;
  const giftedMessages = useMemo(
    () => buildRenderableGiftedMessages(messages, threadSnapshot.liveStream, thread.running),
    [messages, thread.running, threadSnapshot.liveStream],
  );

  const scrollToLatestMessage = useCallback((animated = false) => {
    requestAnimationFrame(() => {
      if (typeof messagesContainerRef.current?.scrollToEnd === "function") {
        messagesContainerRef.current.scrollToEnd({ animated });
        return;
      }

      if (typeof messagesContainerRef.current?.scrollToOffset === "function") {
        messagesContainerRef.current.scrollToOffset({ animated, offset: Number.MAX_SAFE_INTEGER });
      }
    });
  }, []);

  useEffect(() => {
    if (loadingMessages) {
      return;
    }

    scrollToLatestMessage(false);
  }, [giftedMessages.length, loadingMessages, scrollToLatestMessage, thread.id, threadSnapshot.liveStream?.assistantText, threadSnapshot.liveStream?.planText, threadSnapshot.liveStream?.reasoningText]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const modelOptionsForSheet = [
    {
      value: "__default__",
      label: `기본값 (${thread.effectiveModel || "자동"})`,
    },
    ...modelOptions.map((model) => ({
      value: model.value,
      label: model.label,
      description: `기본 effort ${formatEffortLabel(model.defaultReasoningEffort)}`,
    })),
  ];

  const effortOptionsForSheet = [
    {
      value: "__default__",
      label: `기본값 (${thread.effectiveReasoningEffort || selectedModel?.defaultReasoningEffort || "자동"})`,
    },
    ...(selectedModel?.supportedReasoningEfforts || []).map((effort) => ({
      value: effort,
      label: formatEffortLabel(effort),
    })),
  ];

  const chatListHeader = (
    <View style={styles.chatListHeader}>
      <View style={styles.chatContextCard}>
        <Text style={styles.chatContextLabel}>Live Workspace</Text>
        <Text style={styles.chatContextValue}>{deviceName}</Text>
        <Text numberOfLines={1} style={styles.chatContextSubtext}>
          {project.folderPath}
        </Text>
        <View style={styles.chatContextMeta}>
          <Text style={styles.chatContextMetaText}>{thread.effectiveModel || "자동"}</Text>
          <Text style={styles.chatContextMetaText}>
            {thread.composerSettings.defaultMode === "plan" ? "Plan mode" : "Default mode"}
          </Text>
          <Text style={styles.chatContextMetaText}>
            {formatPermissionLabel(thread.composerSettings.permissionMode)}
          </Text>
        </View>
      </View>

      {thread.running ? (
        <View style={styles.runningState}>
          <View style={styles.runningDot} />
          <Text style={styles.runningText}>
            Codex 작업 중{thread.currentMode === "plan" ? " · plan mode" : ""}
          </Text>
        </View>
      ) : null}

      {threadSnapshot.hasMoreBefore ? (
        <View style={styles.hasMoreBanner}>
          <Text style={styles.hasMoreText}>이전 메시지가 더 있습니다. 모바일에서는 최신 대화 중심으로 표시됩니다.</Text>
        </View>
      ) : null}
    </View>
  );
  const giftedListViewProps = useMemo(
    () =>
      ({
        ListHeaderComponent: chatListHeader,
        contentContainerStyle: giftedMessages.length ? styles.chatContent : styles.chatContentEmpty,
        keyboardDismissMode: Platform.OS === "ios" ? "interactive" : "on-drag",
        keyboardShouldPersistTaps: "handled",
        maintainVisibleContentPosition: {
          minIndexForVisible: 0,
        },
        onContentSizeChange: () => {
          if (!loadingMessages) {
            scrollToLatestMessage(false);
          }
        },
        showsVerticalScrollIndicator: false,
      }) as Record<string, unknown>,
    [chatListHeader, giftedMessages.length, loadingMessages, scrollToLatestMessage],
  );

  const renderChatEmpty = useCallback(() => {
    if (loadingMessages) {
      return (
        <View style={styles.chatEmptyState}>
          <ActivityIndicator color={palette.chatAccent} size="small" />
          <Text style={styles.chatEmptyText}>Loading thread messages…</Text>
        </View>
      );
    }

    return (
      <View style={styles.chatEmptyState}>
        <Text style={styles.chatEmptyTitle}>No messages yet</Text>
        <Text style={styles.chatEmptyText}>첫 메시지를 보내면 Codex 세션이 시작됩니다.</Text>
      </View>
    );
  }, [loadingMessages]);

  const renderGiftedMessage = useCallback(
    (props: MessageProps<GiftedRelayMessage>) => {
      const currentMessage = props.currentMessage;
      if (!currentMessage) {
        return <View />;
      }

      if (currentMessage.kind !== "history") {
        return <LiveMessageRow kind={currentMessage.kind} text={currentMessage.liveText} />;
      }

      return (
        <View style={styles.messageRowWrap}>
          <MessageRow
            authToken={authToken}
            authUserName={authUserName}
            deviceId={deviceId}
            latestUndoableTurnRunId={latestUndoableTurnRunId}
            message={currentMessage.record}
            onCancelUserInputRequest={onCancelUserInputRequest}
            onSubmitUserInputRequest={onSubmitUserInputRequest}
            onUndoTurn={onUndoTurn}
            preview={preview}
            respondingUserInputRequestId={respondingUserInputRequestId}
            stoppingThread={stoppingThread}
            undoingTurnRunId={undoingTurnRunId}
          />
        </View>
      );
    },
    [
      authToken,
      authUserName,
      deviceId,
      latestUndoableTurnRunId,
      onCancelUserInputRequest,
      onSubmitUserInputRequest,
      onUndoTurn,
      preview,
      respondingUserInputRequestId,
      stoppingThread,
      undoingTurnRunId,
    ],
  );

  return (
    <View style={styles.chatRoot}>
      <SafeAreaView edges={["top"]} style={styles.chatSafeArea}>
        <View
          style={styles.chatTopBar}
        >
          <View style={styles.topBarLeft}>
            <Pressable onPress={onBack} style={styles.chatHeaderButton}>
              <Ionicons color={palette.chatText} name="arrow-back" size={20} />
            </Pressable>
            <View style={styles.topBarCopy}>
              <Text numberOfLines={1} style={styles.chatTitle}>
                {thread.title}
              </Text>
              <Text numberOfLines={1} style={styles.chatSubtitle}>
                {project.name} · {deviceName}
              </Text>
            </View>
          </View>
          <Pressable onPress={onSignOut} style={styles.chatHeaderButton}>
            <Ionicons color={palette.chatText} name="settings-outline" size={20} />
          </Pressable>
        </View>

        <View style={styles.chatBody}>
          <GiftedChat<GiftedRelayMessage>
            bottomOffset={0}
            inverted={false}
            listViewProps={giftedListViewProps}
            messages={giftedMessages}
            messageContainerRef={messagesContainerRef}
            messagesContainerStyle={styles.chatMessagesContainer}
            minInputToolbarHeight={0}
            onSend={() => undefined}
            renderChatEmpty={renderChatEmpty}
            renderChatFooter={() => (error ? <Text style={styles.chatInlineError}>{error}</Text> : null)}
            renderDay={() => null}
            renderInputToolbar={(_props: InputToolbarProps<GiftedRelayMessage>) => (
              <GiftedComposerToolbar
                activeSheet={activeSheet}
                bottomInset={insets.bottom}
                draft={draft}
                effortValue={effortValue}
                keyboardVisible={keyboardVisible}
                onChangeDraft={onChangeDraft}
                onChangeSheet={onChangeSheet}
                onOpenAttachmentPicker={onOpenAttachmentPicker}
                onSend={onSend}
                onTogglePlanMode={onTogglePlanMode}
                permissionLabel={formatPermissionLabel(thread.composerSettings.permissionMode)}
                selectedModelLabel={selectedModel?.label || thread.effectiveModel || "모델"}
                selectedModelReasoning={thread.effectiveReasoningEffort || selectedModel?.defaultReasoningEffort}
                stoppingThread={stoppingThread}
                submittingMessage={submittingMessage}
                thread={thread}
                updatingControl={updatingControl}
              />
            )}
            renderMessage={renderGiftedMessage}
            text={draft}
            textInputProps={{
              onChangeText: onChangeDraft,
            }}
            user={{
              _id: "user",
              name: authUserName,
            }}
          />
        </View>

        <ComposerSheetModal
          onClose={() => onChangeSheet(null)}
          onSelect={(value) => onChangeModel(value === "__default__" ? null : value)}
          options={modelOptionsForSheet}
          selectedValue={modelSheetValue}
          title="모델 선택"
          visible={activeSheet === "model"}
        />
        <ComposerSheetModal
          onClose={() => onChangeSheet(null)}
          onSelect={(value) => onChangeEffort(value === "__default__" ? null : value)}
          options={effortOptionsForSheet}
          selectedValue={effortValue}
          title="Effort 선택"
          visible={activeSheet === "effort"}
        />
        <ComposerSheetModal
          onClose={() => onChangeSheet(null)}
          onSelect={(value) => onChangeAccess(value as WorkspaceThread["composerSettings"]["permissionMode"])}
          options={[
            { value: "default", label: "기본권한", description: "안전한 기본 접근으로 작업합니다." },
            { value: "danger-full-access", label: "전체 액세스", description: "파일 수정과 넓은 명령 실행을 허용합니다." },
          ]}
          selectedValue={permissionValue}
          title="접근 권한"
          visible={activeSheet === "access"}
        />
      </SafeAreaView>
    </View>
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
  authUserName,
  navigation,
  onSignOut,
  preview = null,
  route,
}: ChatScreenProps) {
  const { deviceId, projectId, threadId } = route.params;
  const { device, error: workspaceError, modelOptions, phase, projects } = useWorkspaceRouteState(authToken, deviceId, preview);
  const project = useMemo(() => projects.find((entry) => entry.id === projectId) || null, [projectId, projects]);
  const routeThread = useMemo(() => project?.threads.find((entry) => entry.id === threadId) || null, [project, threadId]);
  const cachedSnapshot = peekWorkspaceThreadSnapshot(deviceId, threadId, preview);
  const [threadSnapshot, setThreadSnapshot] = useState<WorkspaceThreadSnapshot>(
    cachedSnapshot || createEmptyThreadSnapshot(routeThread),
  );
  const [loadingMessages, setLoadingMessages] = useState(!cachedSnapshot?.messages.length);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [draft, setDraft] = useState("");
  const [activeSheet, setActiveSheet] = useState<ComposerSheet>(null);
  const [updatingControl, setUpdatingControl] = useState<string | null>(null);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [undoingTurnRunId, setUndoingTurnRunId] = useState<number | null>(null);
  const [submittingMessage, setSubmittingMessage] = useState(false);
  const [stoppingThread, setStoppingThread] = useState(false);

  useEffect(() => {
    const nextCached = peekWorkspaceThreadSnapshot(deviceId, threadId, preview);
    if (nextCached) {
      setThreadSnapshot(nextCached.thread ? nextCached : { ...nextCached, thread: routeThread });
      setLoadingMessages(false);
      setMessageError(null);
      return;
    }

    setThreadSnapshot(createEmptyThreadSnapshot(routeThread));
    setLoadingMessages(true);
    setMessageError(null);
  }, [deviceId, preview, routeThread, threadId]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    async function refresh(forceRefresh = false) {
      const nextSnapshot = await loadWorkspaceThreadMessages({
        authToken,
        deviceId,
        threadId,
        preview,
        forceRefresh,
      });

      if (cancelled) {
        return;
      }

      setThreadSnapshot(nextSnapshot.thread ? nextSnapshot : { ...nextSnapshot, thread: routeThread });
      setLoadingMessages(false);
      setMessageError(null);
    }

    if (phase !== "ready" || !project || !routeThread) {
      return () => {
        cancelled = true;
      };
    }

    void refresh(reloadNonce > 0).catch((caught) => {
      if (!cancelled) {
        setLoadingMessages(false);
        setMessageError(caught instanceof Error ? caught.message : "Failed to load thread messages.");
      }
    });

    void subscribeWorkspaceRealtime({
      authToken,
      deviceId,
      preview,
      onEvent: (event: RealtimeEvent) => {
        if (cancelled) {
          return;
        }

        if (
          (event.type === "message-event-created" || event.type === "message-event-updated") &&
          event.threadId === threadId
        ) {
          setThreadSnapshot((current) => {
            const nextMessages = mergeMessages(current.messages, [event.event]);
            return {
              ...current,
              thread: current.thread || routeThread,
              messages: nextMessages,
              liveStream: shouldClearLiveStreamForMessages(nextMessages, current.thread?.running || false)
                ? null
                : current.liveStream,
            };
          });
          setLoadingMessages(false);
          return;
        }

        if (event.type === "thread-stream-event" && event.threadId === threadId) {
          setThreadSnapshot((current) => ({
            ...current,
            thread: current.thread || routeThread,
            liveStream: applyThreadStreamEvent(current.liveStream, event.event),
          }));
          return;
        }

        if (event.type === "thread-turn-state" && event.threadId === threadId) {
          setThreadSnapshot((current) => ({
            ...current,
            thread: current.thread
              ? {
                  ...current.thread,
                  running: event.running,
                  queueDepth: event.queueDepth,
                  currentMode: event.mode,
                }
              : routeThread
                ? {
                    ...routeThread,
                    running: event.running,
                    queueDepth: event.queueDepth,
                    currentMode: event.mode,
                  }
                : current.thread,
          }));
          return;
        }

        if (
          (event.type === "thread-messages-updated" && event.threadId === threadId) ||
          (event.type === "workspace-updated" && (event.threadId === threadId || event.projectId === projectId))
        ) {
          void refresh(true).catch((caught) => {
            if (!cancelled) {
              setMessageError(caught instanceof Error ? caught.message : "Failed to refresh thread.");
            }
          });
        }
      },
    })
      .then((nextUnsubscribe) => {
        unsubscribe = nextUnsubscribe;
      })
      .catch((caught) => {
        if (!cancelled) {
          setMessageError(caught instanceof Error ? caught.message : "Realtime sync is unavailable.");
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [authToken, deviceId, phase, preview, project, projectId, reloadNonce, routeThread, threadId]);

  const thread = threadSnapshot.thread || routeThread;

  async function refreshSnapshot(forceRefresh = true) {
    const nextSnapshot = await loadWorkspaceThreadMessages({
      authToken,
      deviceId,
      threadId,
      preview,
      forceRefresh,
    });

    setThreadSnapshot(nextSnapshot.thread ? nextSnapshot : { ...nextSnapshot, thread });
    setMessageError(null);
  }

  async function handleSend() {
    if (!thread) {
      return;
    }

    if (thread.running) {
      setStoppingThread(true);
      try {
        const nextSnapshot = await interruptWorkspaceThread({
          authToken,
          deviceId,
          threadId,
          preview,
        });
        setThreadSnapshot(nextSnapshot.thread ? nextSnapshot : { ...nextSnapshot, thread });
        setMessageError(null);
      } catch (caught) {
        setMessageError(caught instanceof Error ? caught.message : "Failed to stop the current turn.");
      } finally {
        setStoppingThread(false);
      }
      return;
    }

    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }

    const optimisticMessage = makeOptimisticUserMessage(threadId, trimmed, authUserName);
    setDraft("");
    setSubmittingMessage(true);
    setMessageError(null);
    setThreadSnapshot((current) => ({
      ...current,
      thread: current.thread || thread,
      messages: mergeMessages(current.messages, [optimisticMessage]),
      liveStream: null,
    }));

    try {
      const nextSnapshot = await sendWorkspaceThreadMessage({
        authToken,
        deviceId,
        threadId,
        preview,
        content: trimmed,
      });
      setThreadSnapshot(nextSnapshot.thread ? nextSnapshot : { ...nextSnapshot, thread });
    } catch (caught) {
      setDraft(trimmed);
      setThreadSnapshot((current) => ({
        ...current,
        messages: current.messages.filter((message) => message.id !== optimisticMessage.id),
      }));
      setMessageError(caught instanceof Error ? caught.message : "Failed to send the message.");
    } finally {
      setSubmittingMessage(false);
    }
  }

  async function handleComposerUpdate(
    key: string,
    payload: {
      defaultMode?: ThreadMode;
      modelOverride?: string | null;
      reasoningEffortOverride?: string | null;
      permissionMode?: WorkspaceThread["composerSettings"]["permissionMode"];
    },
  ) {
    if (!thread) {
      return;
    }

    setUpdatingControl(key);
    try {
      const updatedThread = await updateWorkspaceComposerSettings({
        authToken,
        deviceId,
        threadId,
        preview,
        ...payload,
      });
      if (updatedThread) {
        setThreadSnapshot((current) => ({
          ...current,
          thread: updatedThread,
        }));
      }
      setMessageError(null);
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : "Failed to update composer settings.");
    } finally {
      setUpdatingControl(null);
      setActiveSheet(null);
    }
  }

  async function handleSubmitUserInputRequest(requestId: string, answers: UserInputAnswers) {
    setRespondingRequestId(requestId);
    try {
      const nextSnapshot = await respondWorkspaceUserInputRequest({
        authToken,
        deviceId,
        threadId,
        requestId,
        answers,
        preview,
      });
      setThreadSnapshot(nextSnapshot.thread ? nextSnapshot : { ...nextSnapshot, thread });
      setMessageError(null);
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : "Failed to submit the selection.");
    } finally {
      setRespondingRequestId(null);
    }
  }

  async function handleUndoTurn(turnRunId: number) {
    setUndoingTurnRunId(turnRunId);
    try {
      const nextSnapshot = await undoWorkspaceThreadTurn({
        authToken,
        deviceId,
        threadId,
        turnRunId,
        preview,
      });
      setThreadSnapshot(nextSnapshot.thread ? nextSnapshot : { ...nextSnapshot, thread });
      setMessageError(null);
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : "Failed to undo the latest turn.");
    } finally {
      setUndoingTurnRunId(null);
    }
  }

  async function handleCancelUserInputRequest() {
    setStoppingThread(true);
    try {
      const nextSnapshot = await interruptWorkspaceThread({
        authToken,
        deviceId,
        threadId,
        preview,
      });
      setThreadSnapshot(nextSnapshot.thread ? nextSnapshot : { ...nextSnapshot, thread });
      setMessageError(null);
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : "Failed to cancel the request.");
    } finally {
      setStoppingThread(false);
    }
  }

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
      onBack={() => {
        if (navigation.canGoBack()) {
          navigation.goBack();
          return;
        }

        navigation.replace("Threads", { deviceId, projectId });
      }}
      onCancelUserInputRequest={() => {
        void handleCancelUserInputRequest();
      }}
      onChangeDraft={setDraft}
      onChangeSheet={setActiveSheet}
      onChangeAccess={(value) => {
        void handleComposerUpdate("access", { permissionMode: value });
      }}
      onChangeEffort={(value) => {
        void handleComposerUpdate("effort", { reasoningEffortOverride: value });
      }}
      onChangeModel={(value) => {
        void handleComposerUpdate("model", { modelOverride: value });
      }}
      onOpenAttachmentPicker={() => {
        Alert.alert("준비 중", "파일 업로드 피커는 다음 단계에서 네이티브로 연결합니다.");
      }}
      onSend={() => {
        void handleSend();
      }}
      onSignOut={() => void onSignOut()}
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
    paddingHorizontal: 22,
    paddingVertical: 20,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#1d211f",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  projectLead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flex: 1,
  },
  projectIconShell: {
    width: 44,
    height: 44,
    borderRadius: 18,
    backgroundColor: palette.accentSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  projectCopy: {
    flex: 1,
    gap: 4,
  },
  projectTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
  },
  projectPath: {
    color: palette.inkMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  fab: {
    position: "absolute",
    right: 24,
    bottom: 32,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: palette.deepSoft,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: palette.deep,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  threadListContent: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 64,
    gap: 10,
  },
  threadCard: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  threadCardCopy: {
    flex: 1,
    gap: 6,
  },
  threadCardTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  threadCardMeta: {
    color: palette.inkSubtle,
    fontSize: 12,
    lineHeight: 18,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  emptyStateCard: {
    borderRadius: 26,
    paddingHorizontal: 22,
    paddingVertical: 24,
    backgroundColor: "rgba(255, 255, 255, 0.82)",
    borderWidth: 1,
    borderColor: palette.border,
    gap: 8,
    alignItems: "center",
  },
  emptyStateTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  emptyStateText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  inlineError: {
    color: palette.error,
    fontSize: 14,
    lineHeight: 21,
  },
  stateRoot: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
    gap: 20,
    backgroundColor: palette.background,
  },
  stateActions: {
    gap: 12,
  },
  blockedTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  blockedText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  chatRoot: {
    flex: 1,
    backgroundColor: palette.chatCanvas,
  },
  chatSafeArea: {
    flex: 1,
    backgroundColor: palette.chatCanvas,
  },
  chatTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.chatBorder,
    backgroundColor: "rgba(10, 15, 16, 0.96)",
  },
  chatHeaderButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  chatTitle: {
    color: palette.chatText,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
  },
  chatSubtitle: {
    color: palette.chatMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  chatContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
    gap: 18,
  },
  chatContentEmpty: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  chatBody: {
    flex: 1,
  },
  chatMessagesContainer: {
    flex: 1,
  },
  chatListHeader: {
    gap: 18,
  },
  chatContextCard: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: palette.chatSurface,
    borderWidth: 1,
    borderColor: palette.chatBorder,
    gap: 8,
  },
  chatContextLabel: {
    color: palette.chatSubtle,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  chatContextValue: {
    color: palette.chatText,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  chatContextSubtext: {
    color: palette.chatMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  chatContextMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chatContextMetaText: {
    color: palette.chatMuted,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  runningState: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  runningDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: palette.chatAccent,
  },
  runningText: {
    color: palette.chatMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  hasMoreBanner: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: palette.chatBorder,
  },
  hasMoreText: {
    color: palette.chatMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  chatEmptyState: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    paddingVertical: 28,
    alignItems: "center",
    gap: 10,
  },
  chatEmptyTitle: {
    color: palette.chatText,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  chatEmptyText: {
    color: palette.chatMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  chatInlineError: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    color: palette.chatError,
    fontSize: 13,
    lineHeight: 20,
  },
  messageRowWrap: {
    width: "100%",
  },
  codexEntry: {
    width: "100%",
    alignItems: "center",
  },
  codexBody: {
    width: "100%",
    maxWidth: 900,
    gap: 12,
  },
  systemAccentLabel: {
    color: palette.chatSubtle,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  caption: {
    color: palette.chatSubtle,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  userEntry: {
    width: "100%",
    alignItems: "center",
  },
  userBubbleWrap: {
    width: "100%",
    maxWidth: 900,
    alignItems: "flex-end",
    gap: 6,
  },
  userBubble: {
    maxWidth: "78%",
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: palette.userBubble,
    gap: 12,
  },
  userCaption: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  timestamp: {
    color: palette.chatSubtle,
    fontSize: 11,
    lineHeight: 16,
  },
  summaryRow: {
    width: "100%",
    alignItems: "center",
  },
  summaryCard: {
    width: "100%",
    maxWidth: 900,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.chatBorder,
    backgroundColor: palette.chatSurface,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
  },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  summaryTitle: {
    color: palette.chatText,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    flex: 1,
  },
  summaryMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  summaryMetaText: {
    color: palette.chatMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  summaryNote: {
    color: palette.chatText,
    fontSize: 14,
    lineHeight: 22,
  },
  summaryFiles: {
    gap: 8,
  },
  summaryFileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryFileCopy: {
    flex: 1,
  },
  summaryFileLabel: {
    color: palette.chatText,
    fontSize: 13,
    lineHeight: 20,
  },
  summaryDelta: {
    color: palette.chatMuted,
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  summaryState: {
    color: palette.chatMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  summaryActionButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryActionSecondary: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  summaryActionGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: palette.chatBorder,
  },
  summaryActionDanger: {
    backgroundColor: "rgba(255, 99, 99, 0.16)",
  },
  summaryActionDisabled: {
    opacity: 0.5,
  },
  summaryActionLabel: {
    color: palette.chatText,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  userInputCard: {
    width: "100%",
    maxWidth: 900,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.chatBorder,
    backgroundColor: palette.chatSurface,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 16,
  },
  userInputHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  userInputState: {
    color: palette.chatAccent,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  userInputQuestions: {
    gap: 14,
  },
  userInputQuestion: {
    gap: 10,
  },
  userInputQuestionHeader: {
    color: palette.chatSubtle,
    fontSize: 11,
    lineHeight: 15,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  userInputQuestionText: {
    color: palette.chatText,
    fontSize: 14,
    lineHeight: 22,
  },
  userInputOptions: {
    gap: 10,
  },
  userInputOption: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.chatBorder,
    backgroundColor: palette.chatSurfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4,
  },
  userInputOptionSelected: {
    borderColor: "rgba(135, 216, 195, 0.56)",
    backgroundColor: "rgba(135, 216, 195, 0.12)",
  },
  userInputOptionLabel: {
    color: palette.chatText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  userInputOptionDescription: {
    color: palette.chatMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  userInputOtherWrap: {
    gap: 10,
  },
  userInputOtherInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.chatBorder,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    color: palette.chatText,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  userInputAnswerSummary: {
    color: palette.chatMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  userInputActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  attachmentChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: palette.chatBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  attachmentChipText: {
    color: palette.chatMuted,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 240,
  },
  attachmentChipRemove: {
    width: 18,
    height: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentImage: {
    width: "100%",
    maxWidth: 520,
    aspectRatio: 1.6,
    borderRadius: 18,
    backgroundColor: "#10171a",
  },
  attachmentLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: palette.chatBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attachmentLinkText: {
    color: palette.chatText,
    fontSize: 13,
    lineHeight: 18,
  },
  attachmentFallback: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  attachmentFallbackText: {
    color: palette.chatMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  chatComposerRail: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: "rgba(10, 15, 16, 0.96)",
    borderTopWidth: 1,
    borderTopColor: palette.chatBorder,
    gap: 12,
  },
  chatControlRow: {
    gap: 8,
    paddingRight: 12,
  },
  controlChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.chatBorder,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  controlChipActive: {
    backgroundColor: "rgba(135, 216, 195, 0.14)",
    borderColor: "rgba(135, 216, 195, 0.36)",
  },
  controlChipDisabled: {
    opacity: 0.55,
  },
  controlChipText: {
    color: palette.chatMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  controlChipTextActive: {
    color: palette.chatText,
  },
  chatComposer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.chatBorder,
    backgroundColor: palette.chatSurface,
    paddingLeft: 16,
    paddingRight: 10,
    paddingTop: 12,
    paddingBottom: 10,
  },
  chatComposerInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 160,
    color: palette.chatText,
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 0,
  },
  chatSendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.deepSoft,
  },
  chatSendButtonDisabled: {
    opacity: 0.45,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: palette.chatSurface,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 28,
    gap: 16,
  },
  sheetTitle: {
    color: palette.chatText,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  sheetOptions: {
    gap: 10,
  },
  sheetOption: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.chatBorder,
    backgroundColor: palette.chatSurfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  sheetOptionSelected: {
    borderColor: "rgba(135, 216, 195, 0.42)",
    backgroundColor: "rgba(135, 216, 195, 0.12)",
  },
  sheetOptionCopy: {
    flex: 1,
    gap: 4,
  },
  sheetOptionLabel: {
    color: palette.chatText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  sheetOptionDescription: {
    color: palette.chatMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});
