import type { RelayAuthExchangeResponse, RelayAuthUser } from "@remote-codex/contracts";
import { normalizeRelayServerUrl } from "@remote-codex/contracts";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

const APP_SCHEME = "remotecodexrelaymobile";
const DEFAULT_RELAY_SERVER_URL = "https://relay.remote-codex.com";
const STORAGE_VERSION = "remote-codex.relay-auth-v2";
const CURRENT_SERVER_KEY = `${STORAGE_VERSION}.current-server`;
const SAVED_SERVERS_KEY = `${STORAGE_VERSION}.saved-servers`;
const LEGACY_MIGRATION_KEY = `${STORAGE_VERSION}.legacy-cleared`;
const LEGACY_AUTH_KEY = "remote-codex.relay-auth";
const LEGACY_SELECTED_DEVICE_KEY = "remote-codex.selected-device-id";

export type StoredAuth = {
  version: 2;
  serverUrl: string;
  methodId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
  user: RelayAuthUser;
};

let refreshPromise: Promise<StoredAuth | null> | null = null;

function makeSessionKey(serverUrl: string): string {
  return `${STORAGE_VERSION}.session.${toStorageSafeServerId(serverUrl)}`;
}

function makeSelectedDeviceKey(serverUrl: string): string {
  return `${STORAGE_VERSION}.selected-device.${toStorageSafeServerId(serverUrl)}`;
}

function toStorageSafeServerId(serverUrl: string): string {
  return normalizeRelayServerUrl(serverUrl).replace(/[^A-Za-z0-9._-]/g, "_");
}

function buildApiUrl(serverUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${serverUrl}${normalizedPath}`;
}

export function getRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: APP_SCHEME,
    path: "login/callback",
    preferLocalhost: true,
  });
}

export function getDefaultRelayServerUrl(): string {
  return normalizeRelayServerUrl(DEFAULT_RELAY_SERVER_URL);
}

function isStoredAuth(value: unknown): value is StoredAuth {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 2 &&
    typeof (value as { serverUrl?: unknown }).serverUrl === "string" &&
    typeof (value as { methodId?: unknown }).methodId === "string" &&
    typeof (value as { accessToken?: unknown }).accessToken === "string" &&
    typeof (value as { refreshToken?: unknown }).refreshToken === "string" &&
    typeof (value as { expiresAt?: unknown }).expiresAt === "string" &&
    typeof (value as { refreshExpiresAt?: unknown }).refreshExpiresAt === "string" &&
    typeof (value as { user?: { id?: unknown; email?: unknown } }).user?.id === "string" &&
    typeof (value as { user?: { id?: unknown; email?: unknown } }).user?.email === "string"
  );
}

async function getRawSavedServerUrls(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(SAVED_SERVERS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter(Boolean)
      .map((entry) => {
        try {
          return normalizeRelayServerUrl(entry);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function setRawSavedServerUrls(urls: string[]): Promise<void> {
  await SecureStore.setItemAsync(SAVED_SERVERS_KEY, JSON.stringify(Array.from(new Set(urls))));
}

export async function clearLegacyAuthStorage(): Promise<void> {
  if ((await SecureStore.getItemAsync(LEGACY_MIGRATION_KEY)) === "1") {
    return;
  }

  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_AUTH_KEY),
    SecureStore.deleteItemAsync(LEGACY_SELECTED_DEVICE_KEY),
    SecureStore.setItemAsync(LEGACY_MIGRATION_KEY, "1"),
  ]);
}

export async function getCurrentServerUrl(): Promise<string> {
  const stored = (await SecureStore.getItemAsync(CURRENT_SERVER_KEY)) || "";
  if (stored) {
    try {
      return normalizeRelayServerUrl(stored);
    } catch {
      await SecureStore.deleteItemAsync(CURRENT_SERVER_KEY);
    }
  }

  const fallback = getDefaultRelayServerUrl();
  await setCurrentServerUrl(fallback);
  return fallback;
}

export async function setCurrentServerUrl(serverUrl: string): Promise<string> {
  const normalized = normalizeRelayServerUrl(serverUrl);
  await SecureStore.setItemAsync(CURRENT_SERVER_KEY, normalized);
  await saveServerUrl(normalized);
  return normalized;
}

export async function getSavedServerUrls(): Promise<string[]> {
  const current = await getCurrentServerUrl();
  return Array.from(new Set([current, ...(await getRawSavedServerUrls())]));
}

export async function saveServerUrl(serverUrl: string): Promise<void> {
  const normalized = normalizeRelayServerUrl(serverUrl);
  const saved = await getRawSavedServerUrls();
  await setRawSavedServerUrls([normalized, ...saved]);
}

export async function removeSavedServerUrl(serverUrl: string): Promise<void> {
  const normalized = normalizeRelayServerUrl(serverUrl);
  const defaultServerUrl = getDefaultRelayServerUrl();
  const saved = await getRawSavedServerUrls();
  await setRawSavedServerUrls(saved.filter((entry) => entry !== normalized));
  await clearStoredAuth(normalized);
  await setSelectedDeviceId(null, normalized);

  if ((await getCurrentServerUrl()) === normalized) {
    if (defaultServerUrl !== normalized) {
      await setCurrentServerUrl(defaultServerUrl);
    } else {
      await SecureStore.deleteItemAsync(CURRENT_SERVER_KEY);
    }
  }
}

export function createStoredAuthFromExchange(
  serverUrl: string,
  methodId: string,
  payload: RelayAuthExchangeResponse,
): StoredAuth {
  if (!payload.session.user) {
    throw new Error("Relay auth exchange did not return an authenticated user.");
  }

  return {
    version: 2,
    serverUrl: normalizeRelayServerUrl(serverUrl),
    methodId,
    accessToken: payload.tokens.accessToken,
    refreshToken: payload.tokens.refreshToken,
    expiresAt: payload.tokens.expiresAt,
    refreshExpiresAt: payload.tokens.refreshExpiresAt,
    user: payload.session.user,
  };
}

export async function getStoredAuth(serverUrl?: string | null): Promise<StoredAuth | null> {
  const resolvedServerUrl = serverUrl ? normalizeRelayServerUrl(serverUrl) : await getCurrentServerUrl();
  const raw = await SecureStore.getItemAsync(makeSessionKey(resolvedServerUrl));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStoredAuth(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function persistStoredAuth(auth: StoredAuth): Promise<void> {
  const normalizedServerUrl = normalizeRelayServerUrl(auth.serverUrl);
  await Promise.all([
    saveServerUrl(normalizedServerUrl),
    setCurrentServerUrl(normalizedServerUrl),
    SecureStore.setItemAsync(makeSessionKey(normalizedServerUrl), JSON.stringify({ ...auth, serverUrl: normalizedServerUrl })),
  ]);
}

export async function clearStoredAuth(serverUrl?: string | null): Promise<void> {
  const resolvedServerUrl = serverUrl ? normalizeRelayServerUrl(serverUrl) : await getCurrentServerUrl();
  await SecureStore.deleteItemAsync(makeSessionKey(resolvedServerUrl));
}

async function refreshStoredAuth(auth: StoredAuth): Promise<StoredAuth | null> {
  const response = await fetch(buildApiUrl(auth.serverUrl, "/api/auth/refresh"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      refreshToken: auth.refreshToken,
    }),
  });

  if (response.status === 401) {
    await clearStoredAuth(auth.serverUrl);
    return null;
  }

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as RelayAuthExchangeResponse;
  const next = createStoredAuthFromExchange(auth.serverUrl, auth.methodId, payload);
  await persistStoredAuth(next);
  return next;
}

export async function getValidStoredAuth(
  serverUrl?: string | null,
  options: { forceRefresh?: boolean } = {},
): Promise<StoredAuth | null> {
  const current = await getStoredAuth(serverUrl);
  if (!current) {
    return null;
  }

  const expiresAtMs = Date.parse(current.expiresAt);
  const shouldRefresh =
    options.forceRefresh ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now() + 60_000;

  if (!shouldRefresh) {
    return current;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshStoredAuth(current).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function getValidAccessToken(
  serverUrl?: string | null,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  return (await getValidStoredAuth(serverUrl, options))?.accessToken || null;
}

export async function getSelectedDeviceId(serverUrl?: string | null): Promise<string | null> {
  const resolvedServerUrl = serverUrl ? normalizeRelayServerUrl(serverUrl) : await getCurrentServerUrl();
  return (await SecureStore.getItemAsync(makeSelectedDeviceKey(resolvedServerUrl))) || null;
}

export async function setSelectedDeviceId(deviceId: string | null, serverUrl?: string | null): Promise<void> {
  const resolvedServerUrl = serverUrl ? normalizeRelayServerUrl(serverUrl) : await getCurrentServerUrl();
  if (!deviceId) {
    await SecureStore.deleteItemAsync(makeSelectedDeviceKey(resolvedServerUrl));
    return;
  }

  await SecureStore.setItemAsync(makeSelectedDeviceKey(resolvedServerUrl), deviceId);
}
