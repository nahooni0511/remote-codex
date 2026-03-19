import { RelayBridgeClient } from "@remote-codex/client-core";
import type { RelayDeviceSummary } from "@remote-codex/contracts";

import { fetchConnectToken, fetchThreadMessages, fetchWorkspaceBootstrap } from "./relay-api";
import type { PreviewWorkspace } from "./preview";
import type { WorkspaceProject, WorkspaceThreadMessage } from "../types";

export type WorkspaceSessionSnapshot = {
  device: RelayDeviceSummary | null;
  projects: WorkspaceProject[];
  loaded: boolean;
  error: string | null;
};

type WorkspaceSessionEntry = WorkspaceSessionSnapshot & {
  client: RelayBridgeClient | null;
  messageCache: Map<number, WorkspaceThreadMessage[]>;
  pending: Promise<WorkspaceSessionSnapshot> | null;
};

type EnsureWorkspaceSessionOptions = {
  authToken: string;
  deviceId: string;
  preview?: PreviewWorkspace | null;
  forceRefresh?: boolean;
};

type LoadThreadMessagesOptions = {
  authToken: string;
  deviceId: string;
  threadId: number;
  preview?: PreviewWorkspace | null;
  forceRefresh?: boolean;
};

const sessions = new Map<string, WorkspaceSessionEntry>();

function sortThreadMessages(messages: WorkspaceThreadMessage[]) {
  return [...messages].sort((left, right) => left.id - right.id);
}

function createEntry(): WorkspaceSessionEntry {
  return {
    client: null,
    device: null,
    error: null,
    loaded: false,
    messageCache: new Map<number, WorkspaceThreadMessage[]>(),
    pending: null,
    projects: [],
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
    loaded: entry.loaded,
    error: entry.error,
  };
}

function previewSnapshot(preview: PreviewWorkspace): WorkspaceSessionSnapshot {
  return {
    device: preview.device,
    projects: preview.projects,
    loaded: true,
    error: null,
  };
}

function resetEntry(entry: WorkspaceSessionEntry) {
  entry.client?.close();
  entry.client = null;
  entry.device = null;
  entry.error = null;
  entry.loaded = false;
  entry.projects = [];
  entry.pending = null;
  entry.messageCache.clear();
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
      entry.projects = bootstrap.projects || [];
      entry.error = null;
      entry.loaded = true;
      entry.messageCache.clear();
      return snapshot(entry);
    } catch (caught) {
      nextClient?.close();
      entry.client?.close();
      entry.client = null;
      entry.loaded = false;
      entry.projects = [];
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
}: LoadThreadMessagesOptions) {
  if (preview) {
    return sortThreadMessages(preview.messagesByThread[threadId] || []);
  }

  const entry = getEntry(deviceId);
  if (!forceRefresh && entry.messageCache.has(threadId)) {
    return sortThreadMessages(entry.messageCache.get(threadId) || []);
  }

  await ensureWorkspaceSession({ authToken, deviceId, preview });
  if (!entry.client) {
    throw new Error("Workspace bridge is not connected.");
  }

  const result = await fetchThreadMessages(entry.client, threadId);
  const messages = sortThreadMessages(result.messages || []);
  entry.messageCache.set(threadId, messages);
  return messages;
}

export function peekWorkspaceThreadMessages(
  deviceId: string,
  threadId: number,
  preview: PreviewWorkspace | null = null,
) {
  if (preview) {
    return sortThreadMessages(preview.messagesByThread[threadId] || []);
  }

  const messages = sessions.get(deviceId)?.messageCache.get(threadId);
  return messages ? sortThreadMessages(messages) : null;
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
