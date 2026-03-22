import { RelayBridgeClient } from "@remote-codex/client-core";
import type {
  AppBootstrap,
  AppUpdateApplyResult,
  AppUpdateStatus,
  CodexPermissionMode,
  DeviceConnectTokenResponse,
  PairingCodeCreateResponse,
  RelayAuthExchangeResponse,
  RelayAuthSession,
  RelayClientAuthConfig,
  RelayDeviceSummary,
  RelayLocalSetupStatusResponse,
  ThreadComposerSettingsResponse,
  ThreadMessagesResponse,
  ThreadMode,
  UserInputAnswers,
} from "@remote-codex/contracts";
import { normalizeRelayServerUrl } from "@remote-codex/contracts";

import { getCurrentServerUrl, getStoredAuth, getValidAccessToken } from "./auth";

export class RelayApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "RelayApiError";
    this.status = status;
  }
}

function buildApiUrl(serverUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${serverUrl}${normalizedPath}`;
}

type RelayRequestOptions = {
  serverUrl?: string;
  accessToken?: string | null;
};

export async function fetchRelayJson<T>(
  path: string,
  options: RequestInit = {},
  requestOptions: RelayRequestOptions = {},
): Promise<T> {
  const serverUrl = requestOptions.serverUrl
    ? normalizeRelayServerUrl(requestOptions.serverUrl)
    : await getCurrentServerUrl();
  const requestUrl = buildApiUrl(serverUrl, path);

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

  const storedAuth = requestOptions.accessToken ? null : await getStoredAuth(serverUrl);
  let token = requestOptions.accessToken ?? (storedAuth ? await getValidAccessToken(serverUrl) : null);
  let response = await send(token);

  if (response.status === 401 && token && !requestOptions.accessToken) {
    token = await getValidAccessToken(serverUrl, { forceRefresh: true });
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

export async function fetchRelayAuthConfig(serverUrl: string) {
  return fetchRelayJson<RelayClientAuthConfig>("/api/auth/config", {}, { serverUrl });
}

export async function exchangeRelayOidcIdToken(serverUrl: string, methodId: string, idToken: string) {
  return fetchRelayJson<RelayAuthExchangeResponse>(
    "/api/auth/oidc/exchange",
    {
      method: "POST",
      body: JSON.stringify({ methodId, idToken }),
    },
    { serverUrl },
  );
}

export async function fetchRelayLocalSetupStatus(serverUrl: string, methodId: string) {
  return fetchRelayJson<RelayLocalSetupStatusResponse>(
    `/api/auth/local/setup-status?methodId=${encodeURIComponent(methodId)}`,
    {},
    { serverUrl },
  );
}

export async function loginRelayLocalAdmin(serverUrl: string, methodId: string, email: string, password: string) {
  return fetchRelayJson<RelayAuthExchangeResponse>(
    "/api/auth/local/login",
    {
      method: "POST",
      body: JSON.stringify({ methodId, email, password }),
    },
    { serverUrl },
  );
}

export async function setupRelayLocalAdmin(
  serverUrl: string,
  methodId: string,
  email: string,
  password: string,
  bootstrapToken: string,
) {
  return fetchRelayJson<RelayAuthExchangeResponse>(
    "/api/auth/local/setup",
    {
      method: "POST",
      body: JSON.stringify({ methodId, email, password, bootstrapToken }),
    },
    { serverUrl },
  );
}

export async function logoutRelaySession(serverUrl: string, refreshToken?: string | null) {
  try {
    await fetchRelayJson<void>(
      "/api/auth/logout",
      {
        method: "POST",
        body: JSON.stringify({ refreshToken: refreshToken || null }),
      },
      { serverUrl },
    );
  } catch {
    // Best-effort logout. Local auth state is still cleared by the caller.
  }
}

export async function fetchDevices(accessToken: string, serverUrl?: string) {
  return fetchRelayJson<{ devices: RelayDeviceSummary[] }>("/api/devices", {}, { serverUrl, accessToken });
}

export async function createPairingCode(accessToken: string, ownerLabel: string, serverUrl?: string) {
  return fetchRelayJson<PairingCodeCreateResponse>(
    "/api/pairing-codes",
    {
      method: "POST",
      body: JSON.stringify({ ownerLabel }),
    },
    { serverUrl, accessToken },
  );
}

export async function fetchConnectToken(accessToken: string, deviceId: string, serverUrl?: string) {
  return fetchRelayJson<DeviceConnectTokenResponse>(
    `/api/devices/${encodeURIComponent(deviceId)}/connect-token`,
    {
      method: "POST",
    },
    { serverUrl, accessToken },
  );
}

export async function fetchBlockedUpdateStatus(accessToken: string, deviceId: string, serverUrl?: string) {
  return fetchRelayJson<AppUpdateStatus>(
    `/api/devices/${encodeURIComponent(deviceId)}/update/check`,
    {
      method: "POST",
    },
    { serverUrl, accessToken },
  );
}

export async function applyBlockedUpdate(accessToken: string, deviceId: string, serverUrl?: string) {
  return fetchRelayJson<AppUpdateApplyResult>(
    `/api/devices/${encodeURIComponent(deviceId)}/update/apply`,
    {
      method: "POST",
    },
    { serverUrl, accessToken },
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
