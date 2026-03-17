const STORAGE_KEY = "remote-codex:relay-auth";
const PKCE_STATE_KEY = "remote-codex:relay-pkce-state";
const PKCE_VERIFIER_KEY = "remote-codex:relay-pkce-verifier";
const PROD_HOSTNAME = "remote-codex.com";
const PROD_COGNITO_DOMAIN = "https://remote-codex-158300319210-apne2.auth.ap-northeast-2.amazoncognito.com";
const PROD_COGNITO_CLIENT_ID = "4941454ecaeoaagaser2hsv18m";

type StoredAuth = {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

type TokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in?: number;
};

function normalizeCognitoDomain(): string {
  const configured = (import.meta.env.VITE_COGNITO_DOMAIN || "").trim();
  if (configured) {
    return configured.startsWith("http://") || configured.startsWith("https://")
      ? configured.replace(/\/$/, "")
      : `https://${configured.replace(/\/$/, "")}`;
  }

  if (window.location.hostname === PROD_HOSTNAME) {
    return PROD_COGNITO_DOMAIN;
  }

  throw new Error("VITE_COGNITO_DOMAIN is not configured.");
}

function getClientId(): string {
  const value = (import.meta.env.VITE_COGNITO_CLIENT_ID || "").trim();
  if (value) {
    return value;
  }

  if (window.location.hostname === PROD_HOSTNAME) {
    return PROD_COGNITO_CLIENT_ID;
  }

  throw new Error("VITE_COGNITO_CLIENT_ID is not configured.");
}

function buildRedirectUri(): string {
  return new URL("/login/callback", window.location.origin).toString();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export function getStoredAuth(): StoredAuth | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed.idToken) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function getIdToken(): string | null {
  return getStoredAuth()?.idToken || null;
}

export function clearStoredAuth(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export async function startHostedUiSignIn(): Promise<void> {
  const state = randomString(24);
  const verifier = randomString(48);
  const challenge = bytesToBase64Url(await sha256(verifier));

  window.sessionStorage.setItem(PKCE_STATE_KEY, state);
  window.sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);

  const url = new URL(`${normalizeCognitoDomain()}/login`);
  url.searchParams.set("client_id", getClientId());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("redirect_uri", buildRedirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  window.location.assign(url.toString());
}

export async function completeHostedUiSignIn(input: { code: string; state: string | null }): Promise<void> {
  const expectedState = window.sessionStorage.getItem(PKCE_STATE_KEY);
  const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!input.code || !input.state || !expectedState || input.state !== expectedState || !verifier) {
    throw new Error("Invalid Cognito callback state.");
  }

  const response = await fetch(`${normalizeCognitoDomain()}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: getClientId(),
      code: input.code,
      redirect_uri: buildRedirectUri(),
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as TokenResponse;
  const storedAuth: StoredAuth = {
    idToken: payload.id_token,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresAt: typeof payload.expires_in === "number" ? Date.now() + payload.expires_in * 1000 : null,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedAuth));
  window.sessionStorage.removeItem(PKCE_STATE_KEY);
  window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
}

export function signOutHostedUi(): void {
  const url = new URL(`${normalizeCognitoDomain()}/logout`);
  url.searchParams.set("client_id", getClientId());
  url.searchParams.set("logout_uri", new URL("/login", window.location.origin).toString());
  clearStoredAuth();
  window.location.assign(url.toString());
}
