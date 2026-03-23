import { isLoopbackHost, normalizeRelayServerUrl } from "@remote-codex/contracts";

const PROD_HOSTNAME = "remote-codex.com";
const DEV_RELAY_PORT = 3100;
const RELAY_SERVER_STORAGE_KEY = "remote-codex:relay-web-server-url";

export const DEFAULT_RELAY_SERVER_URL = "https://relay.remote-codex.com";

function isHostedSite(): boolean {
  return window.location.hostname === PROD_HOSTNAME;
}

export function sanitizeRelayServerUrlForCurrentHost(serverUrl: string | null | undefined): string | null {
  if (!serverUrl) {
    return null;
  }

  try {
    const normalized = normalizeRelayServerUrl(serverUrl);
    const hostname = new URL(normalized).hostname;
    if (isHostedSite() && isLoopbackHost(hostname)) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
}

function getEnvironmentRelayServerUrl(): string | null {
  const configured = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (!configured) {
    return null;
  }

  return sanitizeRelayServerUrlForCurrentHost(configured);
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

  if (isHostedSite()) {
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
    const sanitized = sanitizeRelayServerUrlForCurrentHost(stored);
    if (sanitized) {
      return sanitized;
    }

    window.localStorage.removeItem(RELAY_SERVER_STORAGE_KEY);
  }

  return getInitialRelayServerUrl();
}

export function setRelayServerUrl(value: string): string {
  const normalized = sanitizeRelayServerUrlForCurrentHost(value);
  if (!normalized) {
    throw new Error("This relay server URL is not available from the hosted site.");
  }

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
