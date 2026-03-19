import type { RelayAuthSession } from "@remote-codex/contracts";

import { getValidIdToken } from "./auth";

const PROD_HOSTNAME = "remote-codex.com";
const PROD_API_BASE_URL = "https://relay.remote-codex.com";

export class RelayApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "RelayApiError";
    this.status = status;
  }
}

function getApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  if (window.location.hostname === PROD_HOSTNAME) {
    return PROD_API_BASE_URL;
  }

  return "";
}

function buildApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

function getResolvedRequestUrl(path: string): string {
  return new URL(buildApiUrl(path), window.location.origin).toString();
}

export async function fetchRelayJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestUrl = getResolvedRequestUrl(path);
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
      const apiBaseUrl = getApiBaseUrl();
      const hint = apiBaseUrl
        ? `Check that the relay API at ${apiBaseUrl} is reachable from this browser.`
        : "This host has no explicit relay API base URL. For local Vite development, ensure the dev server proxy can reach the relay API. For deployed builds, set VITE_API_BASE_URL or provide a same-origin /api proxy.";
      throw new RelayApiError(`Network request failed for ${requestUrl}. ${hint}`);
    }
  };

  let token = await getValidIdToken();
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
