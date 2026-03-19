import type { RelayClientAuthConfig } from "@remote-codex/contracts";
import { Amplify } from "aws-amplify";
import { fetchAuthSession, getCurrentUser, signInWithRedirect, signOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";

const PROD_HOSTNAME = "remote-codex.com";
const PROD_API_BASE_URL = "https://relay.remote-codex.com";
const PROD_COGNITO_DOMAIN = "https://remote-codex-158300319210-apne2.auth.ap-northeast-2.amazoncognito.com";

let initPromise: Promise<void> | null = null;

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

function getCognitoDomain(): string {
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

function getRedirectUri(): string {
  return new URL("/login/callback", window.location.origin).toString();
}

function getSignOutUri(): string {
  return new URL("/login", window.location.origin).toString();
}

async function fetchClientAuthConfig(): Promise<RelayClientAuthConfig> {
  const response = await fetch(buildApiUrl("/api/auth/config"));
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as RelayClientAuthConfig;
}

function normalizeAmplifyDomain(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function initializeRelayAuth(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const config = await fetchClientAuthConfig();
      Amplify.configure({
        Auth: {
          Cognito: {
            userPoolId: config.userPoolId,
            userPoolClientId: config.clientId,
            loginWith: {
              email: true,
              oauth: {
                domain: normalizeAmplifyDomain(getCognitoDomain()),
                scopes: ["openid", "email"],
                redirectSignIn: [getRedirectUri()],
                redirectSignOut: [getSignOutUri()],
                responseType: "code",
              },
            },
          },
        },
      });
    } catch (caught) {
      initPromise = null;
      throw caught;
    }
  })();

  return initPromise;
}

async function hasAuthenticatedUser(): Promise<boolean> {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}

function getAuthErrorMessage(input: unknown): string {
  if (input instanceof Error && input.message) {
    return input.message;
  }

  if (
    typeof input === "object" &&
    input !== null &&
    "error" in input &&
    typeof (input as { error?: unknown }).error === "object" &&
    (input as { error: { message?: unknown } }).error &&
    typeof (input as { error: { message?: unknown } }).error.message === "string"
  ) {
    return (input as { error: { message: string } }).error.message;
  }

  return "Cognito sign-in did not complete.";
}

export async function startHostedUiSignIn(): Promise<void> {
  await initializeRelayAuth();
  await signInWithRedirect();
}

export async function completeHostedUiSignIn(): Promise<void> {
  await initializeRelayAuth();
  if (await hasAuthenticatedUser()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let cancel: () => void = () => {};
    const timeout = window.setTimeout(async () => {
      cancel();
      if (await hasAuthenticatedUser()) {
        resolve();
        return;
      }

      reject(new Error("Cognito sign-in did not complete."));
    }, 5000);

    cancel = Hub.listen("auth", async ({ payload }) => {
      if (payload.event === "signedIn" || payload.event === "signInWithRedirect") {
        window.clearTimeout(timeout);
        cancel();
        resolve();
        return;
      }

      if (payload.event === "signInWithRedirect_failure") {
        window.clearTimeout(timeout);
        cancel();
        reject(new Error(getAuthErrorMessage(payload.data)));
      }
    });
  });
}

export async function getValidIdToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  await initializeRelayAuth();

  try {
    const session = await fetchAuthSession({ forceRefresh: options.forceRefresh });
    return session.tokens?.idToken?.toString() || null;
  } catch {
    return null;
  }
}

export async function signOutHostedUi(): Promise<void> {
  await initializeRelayAuth();
  await signOut({
    global: false,
    oauth: {
      redirectUrl: getSignOutUri(),
    },
  });
}
