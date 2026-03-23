import { RelayBridgeClient } from "@remote-codex/client-core";
import type {
  AppBootstrap,
  BridgeHttpResponsePayload,
  CodexPermissionMode,
  RelayDeviceSummary,
  RealtimeEvent,
  ThreadLiveStreamSnapshot,
  ThreadMode,
  UserInputAnswers,
} from "@remote-codex/contracts";

import {
  createProjectThread,
  fetchConnectToken,
  fetchMessageAttachment,
  fetchThreadMessages,
  fetchWorkspaceBootstrap,
  interruptThreadTurn,
  postThreadMessage,
  respondToThreadUserInputRequest,
  undoThreadTurn,
  updateThreadComposerSettings,
} from "./relay-api";
import type { PreviewWorkspace } from "./preview";
import type {
  WorkspaceAttachmentPreview,
  WorkspaceModelOption,
  WorkspaceProject,
  WorkspaceThread,
  WorkspaceThreadSnapshot,
} from "../types";

export type WorkspaceSessionSnapshot = {
  device: RelayDeviceSummary | null;
  projects: WorkspaceProject[];
  modelOptions: WorkspaceModelOption[];
  loaded: boolean;
  error: string | null;
};

type WorkspaceSessionEntry = WorkspaceSessionSnapshot & {
  client: RelayBridgeClient | null;
  pending: Promise<WorkspaceSessionSnapshot> | null;
  threadCache: Map<number, WorkspaceThreadSnapshot>;
};

type EnsureWorkspaceSessionOptions = {
  authToken: string;
  deviceId: string;
  preview?: PreviewWorkspace | null;
  forceRefresh?: boolean;
};

type LoadThreadMessagesOptions = EnsureWorkspaceSessionOptions & {
  threadId: number;
};

type UpdateComposerSettingsOptions = EnsureWorkspaceSessionOptions & {
  threadId: number;
  defaultMode?: ThreadMode;
  modelOverride?: string | null;
  reasoningEffortOverride?: string | null;
  permissionMode?: CodexPermissionMode;
};

type SendThreadMessageOptions = EnsureWorkspaceSessionOptions & {
  threadId: number;
  content: string;
};

type CreateThreadOptions = EnsureWorkspaceSessionOptions & {
  projectId: number;
  title?: string;
};

type RespondUserInputOptions = EnsureWorkspaceSessionOptions & {
  threadId: number;
  requestId: string;
  answers: UserInputAnswers;
};

type UndoTurnOptions = EnsureWorkspaceSessionOptions & {
  threadId: number;
  turnRunId: number;
};

type InterruptThreadOptions = EnsureWorkspaceSessionOptions & {
  threadId: number;
};

type FetchAttachmentOptions = EnsureWorkspaceSessionOptions & {
  messageId: number;
};

const sessions = new Map<string, WorkspaceSessionEntry>();

function sortMessages(messages: WorkspaceThreadSnapshot["messages"]) {
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime();
    const rightTime = new Date(right.createdAt || 0).getTime();

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return left.id - right.id;
  });
}

function normalizeThreadSnapshot(
  snapshot: Partial<WorkspaceThreadSnapshot> & {
    messages?: WorkspaceThreadSnapshot["messages"];
    thread?: WorkspaceThread | null;
  },
): WorkspaceThreadSnapshot {
  return {
    thread: snapshot.thread ?? null,
    messages: sortMessages(snapshot.messages || []),
    hasMoreBefore: Boolean(snapshot.hasMoreBefore),
    liveStream: (snapshot.liveStream as ThreadLiveStreamSnapshot | null | undefined) || null,
  };
}

function createEntry(): WorkspaceSessionEntry {
  return {
    client: null,
    device: null,
    error: null,
    loaded: false,
    modelOptions: [],
    pending: null,
    projects: [],
    threadCache: new Map<number, WorkspaceThreadSnapshot>(),
  };
}

function getEntry(deviceId: string) {
  const existing = sessions.get(deviceId);
  if (existing) {
    return existing;
  }

  const entry = createEntry();
  sessions.set(deviceId, entry);
  return entry;
}

function snapshot(entry: WorkspaceSessionEntry): WorkspaceSessionSnapshot {
  return {
    device: entry.device,
    projects: entry.projects,
    modelOptions: entry.modelOptions,
    loaded: entry.loaded,
    error: entry.error,
  };
}

function previewSnapshot(preview: PreviewWorkspace): WorkspaceSessionSnapshot {
  return {
    device: preview.device,
    projects: preview.projects,
    modelOptions: preview.modelOptions,
    loaded: true,
    error: null,
  };
}

function updateThreadInProjects(projects: WorkspaceProject[], thread: WorkspaceThread): WorkspaceProject[] {
  return projects.map((project) => {
    if (!project.threads.some((entry) => entry.id === thread.id)) {
      return project;
    }

    return {
      ...project,
      threads: project.threads.map((entry) => (entry.id === thread.id ? thread : entry)),
    };
  });
}

function sortThreadsByRecency(threads: WorkspaceThread[]) {
  return [...threads].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt) || right.id - left.id,
  );
}

function insertThreadInProjects(projects: WorkspaceProject[], thread: WorkspaceThread): WorkspaceProject[] {
  return projects.map((project) => {
    if (project.id !== thread.projectId) {
      return project;
    }

    return {
      ...project,
      updatedAt: thread.updatedAt,
      threads: sortThreadsByRecency([thread, ...project.threads.filter((entry) => entry.id !== thread.id)]),
    };
  });
}

function createPreviewThread(preview: PreviewWorkspace, projectId: number, title: string): WorkspaceThread {
  const project = preview.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error("Project not found.");
  }

  const nextThreadId =
    Math.max(
      0,
      ...preview.projects.flatMap((entry) => entry.threads.map((thread) => thread.id)),
      ...Object.keys(preview.threadSnapshotsById).map((value) => Number(value)).filter(Number.isFinite),
    ) + 1;
  const now = new Date().toISOString();
  const thread: WorkspaceThread = {
    id: nextThreadId,
    projectId,
    title,
    codexThreadId: null,
    codexModelOverride: null,
    codexReasoningEffortOverride: null,
    defaultMode: "default",
    codexPermissionMode: "default",
    origin: "local-ui",
    status: "active",
    createdAt: now,
    updatedAt: now,
    telegramBinding: null,
    effectiveModel: "gpt-5.4",
    effectiveReasoningEffort: "medium",
    running: false,
    queueDepth: 0,
    currentMode: "default",
    composerSettings: {
      defaultMode: "default",
      modelOverride: null,
      reasoningEffortOverride: null,
      permissionMode: "default",
    },
  };

  preview.threadSnapshotsById[nextThreadId] = {
    thread,
    messages: [],
    hasMoreBefore: false,
    liveStream: null,
  };
  preview.projects = insertThreadInProjects(preview.projects, thread);
  return thread;
}

function resetEntry(entry: WorkspaceSessionEntry) {
  entry.client?.close();
  entry.client = null;
  entry.device = null;
  entry.error = null;
  entry.loaded = false;
  entry.modelOptions = [];
  entry.pending = null;
  entry.projects = [];
  entry.threadCache.clear();
}

function cacheThreadSnapshot(entry: WorkspaceSessionEntry, threadId: number, snapshotValue: WorkspaceThreadSnapshot) {
  const normalized = normalizeThreadSnapshot(snapshotValue);
  entry.threadCache.set(threadId, normalized);
  if (normalized.thread) {
    entry.projects = updateThreadInProjects(entry.projects, normalized.thread);
  }
  return normalized;
}

async function requireClient(authToken: string, deviceId: string, preview: PreviewWorkspace | null = null) {
  await ensureWorkspaceSession({ authToken, deviceId, preview });
  const entry = getEntry(deviceId);
  if (!entry.client) {
    throw new Error("Workspace bridge is not connected.");
  }
  return entry.client;
}

function decodeAttachmentResponse(
  response: BridgeHttpResponsePayload,
  fallbackFileName: string | null,
): WorkspaceAttachmentPreview | null {
  if (response.status >= 400 || !response.body) {
    return null;
  }

  const contentType = response.headers["content-type"] || "application/octet-stream";
  const uri =
    response.bodyEncoding === "base64"
      ? `data:${contentType};base64,${response.body}`
      : `data:${contentType};charset=utf-8,${encodeURIComponent(response.body)}`;

  return {
    kind: contentType.startsWith("image/") ? "image" : "file",
    fileName: fallbackFileName,
    contentType,
    uri,
  };
}

export function peekWorkspaceSession(deviceId: string, preview: PreviewWorkspace | null = null) {
  if (preview) {
    return previewSnapshot(preview);
  }

  const entry = sessions.get(deviceId);
  if (!entry?.loaded) {
    return null;
  }

  return snapshot(entry);
}

export async function ensureWorkspaceSession({
  authToken,
  deviceId,
  preview = null,
  forceRefresh = false,
}: EnsureWorkspaceSessionOptions): Promise<WorkspaceSessionSnapshot> {
  if (preview) {
    return previewSnapshot(preview);
  }

  const entry = getEntry(deviceId);
  if (forceRefresh) {
    resetEntry(entry);
  }

  if (entry.loaded && !entry.error) {
    return snapshot(entry);
  }

  if (entry.pending) {
    return entry.pending;
  }

  entry.pending = (async () => {
    let nextClient: RelayBridgeClient | null = null;

    try {
      const connectToken = await fetchConnectToken(authToken, deviceId);
      entry.device = connectToken.device;
      entry.error = null;

      if (connectToken.device.blockedReason) {
        entry.projects = [];
        entry.modelOptions = [];
        entry.loaded = true;
        entry.client?.close();
        entry.client = null;
        return snapshot(entry);
      }

      nextClient = new RelayBridgeClient({ connectToken });
      const state = await nextClient.connect();
      if (state.blockedReason) {
        entry.device = {
          ...connectToken.device,
          blockedReason: state.blockedReason,
        };
        entry.projects = [];
        entry.modelOptions = [];
        entry.loaded = true;
        nextClient.close();
        entry.client?.close();
        entry.client = null;
        return snapshot(entry);
      }

      const bootstrap = await fetchWorkspaceBootstrap(nextClient);
      entry.client?.close();
      entry.client = nextClient;
      nextClient = null;
      entry.device = connectToken.device;
      entry.projects = bootstrap.projects || bootstrap.workspace?.projects || [];
      entry.modelOptions = bootstrap.configOptions?.codexModels || [];
      entry.error = null;
      entry.loaded = true;
      entry.threadCache.clear();
      return snapshot(entry);
    } catch (caught) {
      nextClient?.close();
      entry.client?.close();
      entry.client = null;
      entry.loaded = false;
      entry.projects = [];
      entry.modelOptions = [];
      entry.error = caught instanceof Error ? caught.message : "Failed to load the workspace session.";
      throw new Error(entry.error);
    } finally {
      entry.pending = null;
    }
  })();

  return entry.pending;
}

export async function loadWorkspaceThreadMessages({
  authToken,
  deviceId,
  threadId,
  preview = null,
  forceRefresh = false,
}: LoadThreadMessagesOptions): Promise<WorkspaceThreadSnapshot> {
  if (preview) {
    return normalizeThreadSnapshot(preview.threadSnapshotsById[threadId] || {});
  }

  const entry = getEntry(deviceId);
  if (!forceRefresh && entry.threadCache.has(threadId)) {
    return normalizeThreadSnapshot(entry.threadCache.get(threadId) || {});
  }

  const client = await requireClient(authToken, deviceId, preview);
  const result = await fetchThreadMessages(client, threadId);
  return cacheThreadSnapshot(entry, threadId, normalizeThreadSnapshot(result));
}

export function peekWorkspaceThreadSnapshot(
  deviceId: string,
  threadId: number,
  preview: PreviewWorkspace | null = null,
) {
  if (preview) {
    return normalizeThreadSnapshot(preview.threadSnapshotsById[threadId] || {});
  }

  const snapshotValue = sessions.get(deviceId)?.threadCache.get(threadId);
  return snapshotValue ? normalizeThreadSnapshot(snapshotValue) : null;
}

export async function subscribeWorkspaceRealtime({
  authToken,
  deviceId,
  preview = null,
  onEvent,
}: EnsureWorkspaceSessionOptions & { onEvent: (event: RealtimeEvent) => void }) {
  if (preview) {
    return () => {};
  }

  const client = await requireClient(authToken, deviceId, preview);
  return client.onRealtime(onEvent);
}

export async function sendWorkspaceThreadMessage({
  authToken,
  deviceId,
  threadId,
  preview = null,
  content,
}: SendThreadMessageOptions) {
  if (preview) {
    return normalizeThreadSnapshot(preview.threadSnapshotsById[threadId] || {});
  }

  const client = await requireClient(authToken, deviceId, preview);
  await postThreadMessage(client, threadId, { content });
  return loadWorkspaceThreadMessages({
    authToken,
    deviceId,
    threadId,
    forceRefresh: true,
  });
}

export async function createWorkspaceThread({
  authToken,
  deviceId,
  projectId,
  preview = null,
  title = "New Chat",
}: CreateThreadOptions) {
  const nextTitle = title.trim() || "New Chat";

  if (preview) {
    return createPreviewThread(preview, projectId, nextTitle);
  }

  const client = await requireClient(authToken, deviceId, preview);
  const created = await createProjectThread(client, projectId, { title: nextTitle });

  if (!created?.id || typeof created.id !== "number") {
    throw new Error("The relay returned an invalid thread response.");
  }

  const entry = getEntry(deviceId);
  const result = await fetchThreadMessages(client, created.id);
  const normalized = cacheThreadSnapshot(entry, created.id, normalizeThreadSnapshot(result));

  if (!normalized.thread) {
    throw new Error("The relay did not return the created thread.");
  }

  entry.projects = insertThreadInProjects(entry.projects, normalized.thread);
  return normalized.thread;
}

export async function updateWorkspaceComposerSettings({
  authToken,
  deviceId,
  threadId,
  preview = null,
  defaultMode,
  modelOverride,
  reasoningEffortOverride,
  permissionMode,
}: UpdateComposerSettingsOptions) {
  if (preview) {
    return normalizeThreadSnapshot(preview.threadSnapshotsById[threadId] || {}).thread;
  }

  const client = await requireClient(authToken, deviceId, preview);
  const result = await updateThreadComposerSettings(client, threadId, {
    defaultMode,
    modelOverride,
    reasoningEffortOverride,
    permissionMode,
  });

  const entry = getEntry(deviceId);
  entry.projects = updateThreadInProjects(entry.projects, result.thread);
  if (entry.threadCache.has(threadId)) {
    const cached = entry.threadCache.get(threadId);
    if (cached) {
      cacheThreadSnapshot(entry, threadId, {
        ...cached,
        thread: result.thread,
      });
    }
  }

  return result.thread;
}

export async function respondWorkspaceUserInputRequest({
  authToken,
  deviceId,
  threadId,
  requestId,
  answers,
  preview = null,
}: RespondUserInputOptions) {
  if (!preview) {
    const client = await requireClient(authToken, deviceId, preview);
    await respondToThreadUserInputRequest(client, threadId, requestId, answers);
  }

  return loadWorkspaceThreadMessages({
    authToken,
    deviceId,
    threadId,
    preview,
    forceRefresh: !preview,
  });
}

export async function undoWorkspaceThreadTurn({
  authToken,
  deviceId,
  threadId,
  turnRunId,
  preview = null,
}: UndoTurnOptions) {
  if (!preview) {
    const client = await requireClient(authToken, deviceId, preview);
    await undoThreadTurn(client, threadId, turnRunId);
  }

  return loadWorkspaceThreadMessages({
    authToken,
    deviceId,
    threadId,
    preview,
    forceRefresh: !preview,
  });
}

export async function interruptWorkspaceThread({
  authToken,
  deviceId,
  threadId,
  preview = null,
}: InterruptThreadOptions) {
  if (!preview) {
    const client = await requireClient(authToken, deviceId, preview);
    await interruptThreadTurn(client, threadId);
  }

  return loadWorkspaceThreadMessages({
    authToken,
    deviceId,
    threadId,
    preview,
    forceRefresh: !preview,
  });
}

export async function fetchWorkspaceMessageAttachment({
  authToken,
  deviceId,
  messageId,
  preview = null,
}: FetchAttachmentOptions): Promise<WorkspaceAttachmentPreview | null> {
  if (preview) {
    return preview.attachmentPreviewsByMessageId[messageId] || null;
  }

  const client = await requireClient(authToken, deviceId, preview);
  const response = await fetchMessageAttachment(client, messageId);
  return decodeAttachmentResponse(response, null);
}

export function clearWorkspaceSession(deviceId: string) {
  const entry = sessions.get(deviceId);
  if (!entry) {
    return;
  }

  resetEntry(entry);
  sessions.delete(deviceId);
}

export function clearAllWorkspaceSessions() {
  for (const deviceId of sessions.keys()) {
    clearWorkspaceSession(deviceId);
  }
}
