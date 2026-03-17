import type { RelayAuthSession } from "@remote-codex/contracts";

import { getIdToken } from "./auth";

const PROD_HOSTNAME = "remote-codex.com";
const PROD_API_BASE_URL = "https://relay.remote-codex.com";

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

export async function fetchRelayJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getIdToken();
  const response = await fetch(buildApiUrl(path), {
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(await response.text());
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
