import { useEffect, useMemo, useState } from "react";
import { RelayBridgeClient } from "@remote-codex/client-core";
import type { RelayDeviceSummary } from "@remote-codex/contracts";

import {
  fetchBlockedUpdateStatus,
  fetchConnectToken,
  fetchThreadMessages,
  fetchWorkspaceBootstrap,
} from "../lib/relay";
import type { WorkspaceProject, WorkspaceThreadMessage } from "../types";

type UseRelayWorkspaceOptions = {
  device: RelayDeviceSummary;
  sessionToken: string;
};

export function useRelayWorkspace({ device, sessionToken }: UseRelayWorkspaceOptions) {
  const [relayClient, setRelayClient] = useState<RelayBridgeClient | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<WorkspaceThreadMessage[]>([]);
  const [blockedReason, setBlockedReason] = useState<string | null>(device.blockedReason?.message || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedThreadTitle = useMemo(() => {
    for (const project of projects) {
      const thread = project.threads.find((entry) => entry.id === selectedThreadId);
      if (thread) {
        return thread.title;
      }
    }
    return null;
  }, [projects, selectedThreadId]);

  useEffect(() => {
    let cancelled = false;
    let nextClient: RelayBridgeClient | null = null;

    setLoading(true);
    setError(null);
    setBlockedReason(device.blockedReason?.message || null);
    setSelectedThreadId(null);
    setMessages([]);

    void fetchConnectToken(sessionToken, device.deviceId)
      .then(async (connectToken) => {
        nextClient = new RelayBridgeClient({ connectToken });
        const state = await nextClient.connect();
        if (state.blockedReason) {
          throw new Error(state.blockedReason.message);
        }

        const bootstrap = await fetchWorkspaceBootstrap(nextClient);
        if (cancelled) {
          nextClient.close();
          return;
        }

        setRelayClient(nextClient);
        setProjects(bootstrap.projects || []);
        const firstThreadId = bootstrap.projects[0]?.threads[0]?.id || null;
        setSelectedThreadId(firstThreadId);
        if (firstThreadId) {
          const threadMessages = await fetchThreadMessages(nextClient, firstThreadId);
          if (!cancelled) {
            setMessages(threadMessages.messages || []);
          }
        }
      })
      .catch(async (caught: Error) => {
        if (!cancelled) {
          setError(caught.message);
          if (device.blockedReason) {
            try {
              const status = await fetchBlockedUpdateStatus(sessionToken, device.deviceId);
              setBlockedReason(status.reason || caught.message);
            } catch {
              setBlockedReason(caught.message);
            }
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      nextClient?.close();
      setRelayClient(null);
    };
  }, [device, sessionToken]);

  async function openThread(threadId: number) {
    if (!relayClient) {
      return;
    }

    setSelectedThreadId(threadId);
    setLoading(true);
    setError(null);
    try {
      const result = await fetchThreadMessages(relayClient, threadId);
      setMessages(result.messages || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load thread messages.");
    } finally {
      setLoading(false);
    }
  }

  return {
    blockedReason,
    error,
    loading,
    messages,
    openThread,
    projects,
    selectedThreadId,
    selectedThreadTitle,
  };
}
