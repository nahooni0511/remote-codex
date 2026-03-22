import type {
  RelayAuthExchangeResponse,
  RelayAuthMethod,
  RelayAuthSession,
  RelayClientAuthConfig,
  RelayLocalAdminAuthMethod,
  RelayOidcAuthMethod,
} from "@remote-codex/contracts";

const PROD_HOSTNAME = "remote-codex.com";
const PROD_API_BASE_URL = "https://relay.remote-codex.com";
const STORAGE_KEY = "remote-codex:relay-web-auth-v2";
const OIDC_TRANSACTION_KEY = "remote-codex:relay-web-oidc-transaction";

type StoredAuth = {
  version: 2;
  methodId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
  user: NonNullable<RelayAuthSession["user"]>;
};

type OidcTransaction = {
  methodId: string;
  clientId: string;
  tokenEndpoint: string;
  redirectUri: string;
  codeVerifier: string;
  state: string;
};

function isOidcMethod(method: RelayAuthMethod): method is RelayOidcAuthMethod {
  return method.type === "oidc";
}

export function isLocalAdminMethod(method: RelayAuthMethod): method is RelayLocalAdminAuthMethod {
  return method.type === "local-admin";
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
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return new URL(base ? `${base}${normalizedPath}` : normalizedPath, window.location.origin).toString();
}

function getRedirectUri(): string {
  return new URL("/login/callback", window.location.origin).toString();
}

function base64Url(input: Uint8Array): string {
  return btoa(String.fromCharCode(...input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createRandomString(size = 32): string {
  const values = new Uint8Array(size);
  window.crypto.getRandomValues(values);
  return base64Url(values);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64Url(new Uint8Array(digest));
}

function isStoredAuth(value: unknown): value is StoredAuth {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 2 &&
    typeof (value as { methodId?: unknown }).methodId === "string" &&
    typeof (value as { accessToken?: unknown }).accessToken === "string" &&
    typeof (value as { refreshToken?: unknown }).refreshToken === "string" &&
    typeof (value as { expiresAt?: unknown }).expiresAt === "string" &&
    typeof (value as { refreshExpiresAt?: unknown }).refreshExpiresAt === "string" &&
    typeof (value as { user?: { id?: unknown; email?: unknown } }).user?.id === "string" &&
    typeof (value as { user?: { id?: unknown; email?: unknown } }).user?.email === "string"
  );
}

function createStoredAuth(methodId: string, payload: RelayAuthExchangeResponse): StoredAuth {
  if (!payload.session.user) {
    throw new Error("Relay auth exchange did not return a user.");
  }

  return {
    version: 2,
    methodId,
    accessToken: payload.tokens.accessToken,
    refreshToken: payload.tokens.refreshToken,
    expiresAt: payload.tokens.expiresAt,
    refreshExpiresAt: payload.tokens.refreshExpiresAt,
    user: payload.session.user,
  };
}

function getStoredAuth(): StoredAuth | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
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

function persistStoredAuth(auth: StoredAuth): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

function clearStoredAuth(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

function getStoredOidcTransaction(): OidcTransaction | null {
  const raw = window.sessionStorage.getItem(OIDC_TRANSACTION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as OidcTransaction;
  } catch {
    return null;
  }
}

function persistOidcTransaction(transaction: OidcTransaction): void {
  window.sessionStorage.setItem(OIDC_TRANSACTION_KEY, JSON.stringify(transaction));
}

function clearOidcTransaction(): void {
  window.sessionStorage.removeItem(OIDC_TRANSACTION_KEY);
}

export async function fetchRelayAuthConfig(): Promise<RelayClientAuthConfig> {
  const response = await fetch(buildApiUrl("/api/auth/config"));
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as RelayClientAuthConfig;
}

export async function startOidcSignIn(method: RelayOidcAuthMethod): Promise<void> {
  const state = createRandomString();
  const codeVerifier = createRandomString(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const redirectUri = getRedirectUri();

  persistOidcTransaction({
    methodId: method.id,
    clientId: method.clientId,
    tokenEndpoint: method.tokenEndpoint,
    redirectUri,
    codeVerifier,
    state,
  });

  const url = new URL(method.authorizationEndpoint);
  url.searchParams.set("client_id", method.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", method.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
}

export async function completeOidcSignIn(): Promise<RelayAuthSession> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const authError = params.get("error_description") || params.get("error");
  if (authError) {
    throw new Error(authError);
  }

  const transaction = getStoredOidcTransaction();
  if (!transaction || !code || !state || state !== transaction.state) {
    throw new Error("OIDC sign-in transaction is invalid or expired.");
  }

  const tokenResponse = await fetch(transaction.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: transaction.clientId,
      code,
      redirect_uri: transaction.redirectUri,
      code_verifier: transaction.codeVerifier,
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(await tokenResponse.text());
  }

  const tokenPayload = (await tokenResponse.json()) as { id_token?: string };
  if (!tokenPayload.id_token) {
    throw new Error("OIDC provider did not return an id_token.");
  }

  const relayResponse = await fetch(buildApiUrl("/api/auth/oidc/exchange"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      methodId: transaction.methodId,
      idToken: tokenPayload.id_token,
    }),
  });
  if (!relayResponse.ok) {
    throw new Error(await relayResponse.text());
  }

  const payload = (await relayResponse.json()) as RelayAuthExchangeResponse;
  persistStoredAuth(createStoredAuth(transaction.methodId, payload));
  clearOidcTransaction();
  return payload.session;
}

export async function loginLocalAdmin(methodId: string, email: string, password: string): Promise<RelayAuthSession> {
  const response = await fetch(buildApiUrl("/api/auth/local/login"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ methodId, email, password }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as RelayAuthExchangeResponse;
  persistStoredAuth(createStoredAuth(methodId, payload));
  return payload.session;
}

export async function setupLocalAdmin(
  methodId: string,
  email: string,
  password: string,
  bootstrapToken: string,
): Promise<RelayAuthSession> {
  const response = await fetch(buildApiUrl("/api/auth/local/setup"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ methodId, email, password, bootstrapToken }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as RelayAuthExchangeResponse;
  persistStoredAuth(createStoredAuth(methodId, payload));
  return payload.session;
}

async function refreshStoredAuth(auth: StoredAuth): Promise<StoredAuth | null> {
  const response = await fetch(buildApiUrl("/api/auth/refresh"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });

  if (response.status === 401) {
    clearStoredAuth();
    return null;
  }

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as RelayAuthExchangeResponse;
  const next = createStoredAuth(auth.methodId, payload);
  persistStoredAuth(next);
  return next;
}

export async function getValidAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const auth = getStoredAuth();
  if (!auth) {
    return null;
  }

  const expiresAt = Date.parse(auth.expiresAt);
  if (!options.forceRefresh && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
    return auth.accessToken;
  }

  const refreshed = await refreshStoredAuth(auth);
  return refreshed?.accessToken || null;
}

export async function restoreRelaySession(): Promise<RelayAuthSession> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { user: null, expiresAt: null };
  }

  const response = await fetch(buildApiUrl("/api/session"), {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    clearStoredAuth();
    return { user: null, expiresAt: null };
  }

  return (await response.json()) as RelayAuthSession;
}

export async function signOutRelaySession(): Promise<void> {
  const auth = getStoredAuth();
  try {
    await fetch(buildApiUrl("/api/auth/logout"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ refreshToken: auth?.refreshToken || null }),
    });
  } finally {
    clearStoredAuth();
  }
}
