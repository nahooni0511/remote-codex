import { isLoopbackHost, normalizeRelayServerUrl } from "@remote-codex/contracts";

const PROD_HOSTNAME = "remote-codex.com";
const DEV_RELAY_PORT = 3100;
const RELAY_SERVER_STORAGE_KEY = "remote-codex:relay-web-server-url";

export const DEFAULT_RELAY_SERVER_URL = "https://relay.remote-codex.com";

function getEnvironmentRelayServerUrl(): string | null {
  const configured = (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_DEV_API_TARGET || "").trim();
  if (!configured) {
    return null;
  }

  try {
    return normalizeRelayServerUrl(configured);
  } catch {
    return null;
  }
}

function getDevelopmentRelayServerUrl(): string | null {
  const hostname = window.location.hostname;
  if (!isLoopbackHost(hostname)) {
    return null;
  }

  return normalizeRelayServerUrl(`http://${hostname}:${DEV_RELAY_PORT}`);
}

function getInitialRelayServerUrl(): string {
  const environmentRelayServerUrl = getEnvironmentRelayServerUrl();
  if (environmentRelayServerUrl) {
    return environmentRelayServerUrl;
  }

  if (window.location.hostname === PROD_HOSTNAME) {
    return DEFAULT_RELAY_SERVER_URL;
  }

  const developmentRelayServerUrl = getDevelopmentRelayServerUrl();
  if (developmentRelayServerUrl) {
    return developmentRelayServerUrl;
  }

  if (window.location.protocol === "https:") {
    try {
      return normalizeRelayServerUrl(window.location.origin);
    } catch {
      // Fall through to the hosted default below.
    }
  }

  return DEFAULT_RELAY_SERVER_URL;
}

export function getRelayServerUrl(): string {
  const stored = window.localStorage.getItem(RELAY_SERVER_STORAGE_KEY);
  if (stored) {
    try {
      return normalizeRelayServerUrl(stored);
    } catch {
      window.localStorage.removeItem(RELAY_SERVER_STORAGE_KEY);
    }
  }

  return getInitialRelayServerUrl();
}

export function setRelayServerUrl(value: string): string {
  const normalized = normalizeRelayServerUrl(value);
  window.localStorage.setItem(RELAY_SERVER_STORAGE_KEY, normalized);
  return normalized;
}

export function buildRelayApiUrl(path: string, serverUrl = getRelayServerUrl()): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeRelayServerUrl(serverUrl)}${normalizedPath}`;
}

export function isDefaultRelayServerUrl(serverUrl: string): boolean {
  return normalizeRelayServerUrl(serverUrl) === DEFAULT_RELAY_SERVER_URL;
}
