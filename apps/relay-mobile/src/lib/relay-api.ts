import { RelayBridgeClient } from "@remote-codex/client-core";
import type {
  AppUpdateApplyResult,
  AppUpdateStatus,
  DeviceConnectTokenResponse,
  PairingCodeCreateResponse,
  RelayAuthSession,
  RelayDeviceSummary,
} from "@remote-codex/contracts";

import { getStoredAuth, getValidIdToken } from "./auth";

const PROD_API_BASE_URL = "https://relay.remote-codex.com";

export class RelayApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "RelayApiError";
    this.status = status;
  }
}

export function getApiBaseUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_RELAY_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  return PROD_API_BASE_URL;
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
  return JSON.parse(response.body || "null") as {
    projects: Array<{
      id: number;
      name: string;
      folderPath: string;
      threads: Array<{ id: number; title: string }>;
    }>;
    device: { displayName: string };
  };
}

export async function fetchThreadMessages(client: RelayBridgeClient, threadId: number) {
  const response = await client.request({
    method: "GET",
    path: `/api/threads/${threadId}/messages`,
  });
  return JSON.parse(response.body || "null") as {
    messages: Array<{ id: number; role: string; content: string }>;
  };
}
