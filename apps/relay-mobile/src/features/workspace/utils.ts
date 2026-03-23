import type { RelayDeviceSummary } from "@remote-codex/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import type {
  WorkspaceModelOption,
  WorkspaceProject,
  WorkspaceThread,
  WorkspaceThreadMessage,
  WorkspaceThreadSnapshot,
} from "../../types";
import type { GiftedRelayMessage, WorkspaceRoutePhase } from "./types";

export function resolveWorkspacePhase(device: RelayDeviceSummary | null, error: string | null): WorkspaceRoutePhase {
  if (error) {
    return "error";
  }

  if (device?.blockedReason) {
    return "blocked";
  }

  return "ready";
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

  return (
    nextStreamText === nextPersistedText ||
    nextPersistedText.startsWith(nextStreamText) ||
    nextStreamText.startsWith(nextPersistedText)
  );
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

export function buildRenderableGiftedMessages(
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

export function formatPermissionLabel(permission: WorkspaceThread["composerSettings"]["permissionMode"]) {
  return permission === "danger-full-access" ? "전체 액세스" : "기본권한";
}

export function createEmptyThreadSnapshot(thread: WorkspaceThread | null): WorkspaceThreadSnapshot {
  return {
    thread,
    messages: [],
    hasMoreBefore: false,
    liveStream: null,
  };
}

export function hydrateThreadSnapshot(
  snapshot: WorkspaceThreadSnapshot,
  fallbackThread: WorkspaceThread | null,
): WorkspaceThreadSnapshot {
  return snapshot.thread ? snapshot : { ...snapshot, thread: fallbackThread };
}

export function makeOptimisticUserMessage(threadId: number, content: string, authUserName: string): WorkspaceThreadMessage {
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

const projectIcons: Array<keyof typeof MaterialCommunityIcons.glyphMap> = [
  "source-branch",
  "shield-half-full",
  "console-line",
  "graphql",
  "database",
];

export function getProjectIcon(index: number): keyof typeof MaterialCommunityIcons.glyphMap {
  return projectIcons[index % projectIcons.length];
}

export function findProject(projects: WorkspaceProject[], projectId: number) {
  return projects.find((entry) => entry.id === projectId) || null;
}

export function findThread(project: WorkspaceProject | null, threadId: number) {
  return project?.threads.find((entry) => entry.id === threadId) || null;
}

export function getSelectedModel(
  thread: WorkspaceThread,
  modelOptions: WorkspaceModelOption[],
): WorkspaceModelOption | null {
  const selectedModelId = thread.composerSettings.modelOverride || thread.effectiveModel || modelOptions[0]?.value || "";
  return modelOptions.find((entry) => entry.value === selectedModelId) || modelOptions[0] || null;
}
