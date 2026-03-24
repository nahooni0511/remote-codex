import type { RelayAuthSession } from "@remote-codex/contracts";

import { getCurrentAuthServerUrl, getValidAccessToken } from "./auth";
import { buildRelayApiUrl, getRelayServerUrl } from "./relay-server";

export class RelayApiError extends Error {
  status: number | null;
  code?: string;

  constructor(message: string, status: number | null = null, code?: string) {
    super(message);
    this.name = "RelayApiError";
    this.status = status;
    this.code = code;
  }
}

function getResolvedRequestUrl(path: string, serverUrl: string): string {
  return new URL(buildRelayApiUrl(path, serverUrl), window.location.origin).toString();
}

export async function fetchRelayJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const relayServerUrl = getCurrentAuthServerUrl() || getRelayServerUrl();
  const requestUrl = getResolvedRequestUrl(path, relayServerUrl);
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
      const hint = `Check that the relay API at ${relayServerUrl} is reachable from this browser.`;
      throw new RelayApiError(`Network request failed for ${requestUrl}. ${hint}`);
    }
  };

  let token = await getValidAccessToken();
  let response = await send(token);

  if (response.status === 401 && token) {
    token = await getValidAccessToken({ forceRefresh: true });
    if (token) {
      response = await send(token);
    }
  }

  if (!response.ok) {
    const raw = await response.text();
    let payload: { error?: string; code?: string } | null = null;
    try {
      payload = JSON.parse(raw) as { error?: string; code?: string };
    } catch {
      payload = null;
    }

    throw new RelayApiError(payload?.error || raw || "Relay API request failed.", response.status, payload?.code);
  }

  return (await response.json()) as T;
}

export function emptyRelaySession(): RelayAuthSession {
  return { user: null, expiresAt: null };
}

export function getSelectedDeviceId(): string | null {
  return window.localStorage.getItem("remote-codex:selected-device-id");
}

export function setSelectedDeviceId(deviceId: string | null): void {
  if (!deviceId) {
    window.localStorage.removeItem("remote-codex:selected-device-id");
    return;
  }

  window.localStorage.setItem("remote-codex:selected-device-id", deviceId);
}
