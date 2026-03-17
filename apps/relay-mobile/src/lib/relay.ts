import { RelayBridgeClient } from "@remote-codex/client-core";
import type {
  AppUpdateStatus,
  DeviceConnectTokenResponse,
  MagicLinkConsumeResponse,
  MagicLinkRequestResponse,
  RelayAuthSession,
  RelayDeviceSummary,
} from "@remote-codex/contracts";

const relayBaseUrl = (process.env.EXPO_PUBLIC_RELAY_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");

function buildHeaders(sessionToken?: string | null): Record<string, string> {
  return sessionToken ? { "x-remote-codex-session": sessionToken } : {};
}

export function getRelayBaseUrl() {
  return relayBaseUrl;
}

export async function fetchRelayJson<T>(
  path: string,
  options: RequestInit = {},
  sessionToken?: string | null,
): Promise<T> {
  const response = await fetch(`${relayBaseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...buildHeaders(sessionToken),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

export async function requestMagicLink(email: string) {
  return fetchRelayJson<MagicLinkRequestResponse>("/api/auth/request-magic-link", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function consumeMagicLink(token: string) {
  return fetchRelayJson<MagicLinkConsumeResponse>("/api/auth/consume-magic-link", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function fetchSession(sessionToken: string) {
  return fetchRelayJson<RelayAuthSession>("/api/session", {}, sessionToken);
}

export async function fetchDevices(sessionToken: string) {
  return fetchRelayJson<{ devices: RelayDeviceSummary[] }>("/api/devices", {}, sessionToken);
}

export async function fetchConnectToken(sessionToken: string, deviceId: string) {
  return fetchRelayJson<DeviceConnectTokenResponse>(
    `/api/devices/${encodeURIComponent(deviceId)}/connect-token`,
    {
      method: "POST",
    },
    sessionToken,
  );
}

export async function fetchBlockedUpdateStatus(sessionToken: string, deviceId: string) {
  return fetchRelayJson<AppUpdateStatus>(
    `/api/devices/${encodeURIComponent(deviceId)}/update/check`,
    { method: "POST" },
    sessionToken,
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
