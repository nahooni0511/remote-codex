import { RelayBridgeClient } from "@remote-codex/client-core";
import type {
  AppBootstrap,
  AppUpdateApplyResult,
  AppUpdateStatus,
  CodexPermissionMode,
  DeviceConnectTokenResponse,
  PairingCodeCreateResponse,
  RelayAuthSession,
  RelayDeviceSummary,
  ThreadComposerSettingsResponse,
  ThreadMessagesResponse,
  ThreadMode,
  UserInputAnswers,
} from "@remote-codex/contracts";

import { getExpoPublicEnv } from "./env";
import { getStoredAuth, getValidIdToken } from "./auth";

export class RelayApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "RelayApiError";
    this.status = status;
  }
}

export function getApiBaseUrl(): string {
  return getExpoPublicEnv("EXPO_PUBLIC_RELAY_BASE_URL").replace(/\/$/, "");
}

function buildApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

export async function fetchRelayJson<T>(path: string, options: RequestInit = {}, idToken?: string | null): Promise<T> {
  const requestUrl = buildApiUrl(path);
  const send = async (token: string | null): Promise<Response> => {
    try {
      return await fetch(requestUrl, {
        headers: {
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
        ...options,
      });
    } catch {
      throw new RelayApiError(`Network request failed for ${requestUrl}. Check that the relay API is reachable from the simulator.`);
    }
  };

  const hasStoredAuth = Boolean(await getStoredAuth());
  let token = hasStoredAuth ? await getValidIdToken() : idToken || null;
  let response = await send(token);

  if (response.status === 401 && token) {
    token = await getValidIdToken({ forceRefresh: true });
    if (token) {
      response = await send(token);
    }
  }

  if (!response.ok) {
    throw new RelayApiError(await response.text(), response.status);
  }

  return (await response.json()) as T;
}

export function emptyRelaySession(): RelayAuthSession {
  return { user: null, expiresAt: null };
}

export async function fetchDevices(idToken: string) {
  return fetchRelayJson<{ devices: RelayDeviceSummary[] }>("/api/devices", {}, idToken);
}

export async function createPairingCode(idToken: string, ownerLabel: string) {
  return fetchRelayJson<PairingCodeCreateResponse>(
    "/api/pairing-codes",
    {
      method: "POST",
      body: JSON.stringify({ ownerLabel }),
    },
    idToken,
  );
}

export async function fetchConnectToken(idToken: string, deviceId: string) {
  return fetchRelayJson<DeviceConnectTokenResponse>(
    `/api/devices/${encodeURIComponent(deviceId)}/connect-token`,
    {
      method: "POST",
    },
    idToken,
  );
}

export async function fetchBlockedUpdateStatus(idToken: string, deviceId: string) {
  return fetchRelayJson<AppUpdateStatus>(
    `/api/devices/${encodeURIComponent(deviceId)}/update/check`,
    {
      method: "POST",
    },
    idToken,
  );
}

export async function applyBlockedUpdate(idToken: string, deviceId: string) {
  return fetchRelayJson<AppUpdateApplyResult>(
    `/api/devices/${encodeURIComponent(deviceId)}/update/apply`,
    {
      method: "POST",
    },
    idToken,
  );
}

export async function fetchWorkspaceBootstrap(client: RelayBridgeClient) {
  const response = await client.request({
    method: "GET",
    path: "/api/bootstrap",
  });
  return JSON.parse(response.body || "null") as AppBootstrap;
}

export async function fetchThreadMessages(client: RelayBridgeClient, threadId: number) {
  const response = await client.request({
    method: "GET",
    path: `/api/threads/${threadId}/messages`,
  });
  return JSON.parse(response.body || "null") as ThreadMessagesResponse;
}

export async function fetchMessageAttachment(client: RelayBridgeClient, messageId: number) {
  return client.request({
    method: "GET",
    path: `/api/messages/${messageId}/attachment`,
  });
}

export async function postThreadMessage(
  client: RelayBridgeClient,
  threadId: number,
  payload: {
    content: string;
  },
) {
  return client.request({
    method: "POST",
    path: `/api/threads/${threadId}/messages`,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updateThreadComposerSettings(
  client: RelayBridgeClient,
  threadId: number,
  payload: {
    defaultMode?: ThreadMode;
    modelOverride?: string | null;
    reasoningEffortOverride?: string | null;
    permissionMode?: CodexPermissionMode;
  },
) {
  const response = await client.request({
    method: "PATCH",
    path: `/api/threads/${threadId}/composer-settings`,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return JSON.parse(response.body || "null") as ThreadComposerSettingsResponse;
}

export async function respondToThreadUserInputRequest(
  client: RelayBridgeClient,
  threadId: number,
  requestId: string,
  answers: UserInputAnswers,
) {
  return client.request({
    method: "POST",
    path: `/api/threads/${threadId}/user-input-requests/${encodeURIComponent(requestId)}/respond`,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ answers }),
  });
}

export async function undoThreadTurn(client: RelayBridgeClient, threadId: number, turnRunId: number) {
  return client.request({
    method: "POST",
    path: `/api/threads/${threadId}/turns/${turnRunId}/undo`,
  });
}

export async function interruptThreadTurn(client: RelayBridgeClient, threadId: number) {
  return client.request({
    method: "POST",
    path: `/api/threads/${threadId}/interrupt`,
  });
}
