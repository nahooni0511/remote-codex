import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import type { TokenResponseConfig } from "expo-auth-session";
import { TokenError } from "expo-auth-session";

import { getExpoPublicEnv } from "./env";

WebBrowser.maybeCompleteAuthSession();

const STORAGE_KEY = "remote-codex.relay-auth";
const SELECTED_DEVICE_KEY = "remote-codex.selected-device-id";
const APP_SCHEME = "remotecodexrelaymobile";

export type StoredAuth = TokenResponseConfig & { idToken: string };

let refreshPromise: Promise<StoredAuth | null> | null = null;

export function getCognitoDomain(): string {
  const configured = getExpoPublicEnv("EXPO_PUBLIC_COGNITO_DOMAIN");

  return configured.startsWith("http://") || configured.startsWith("https://")
    ? configured.replace(/\/$/, "")
    : `https://${configured.replace(/\/$/, "")}`;
}

export function getCognitoClientId(): string {
  return getExpoPublicEnv("EXPO_PUBLIC_COGNITO_CLIENT_ID");
}

export function getCognitoRegion(): string {
  return getExpoPublicEnv("EXPO_PUBLIC_COGNITO_REGION");
}

export function getRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: APP_SCHEME,
    path: "login/callback",
    preferLocalhost: true,
  });
}

export function getHostedUiDiscovery() {
  const domain = getCognitoDomain();
  return {
    authorizationEndpoint: `${domain}/login`,
    tokenEndpoint: `${domain}/oauth2/token`,
    revocationEndpoint: `${domain}/oauth2/revoke`,
    endSessionEndpoint: `${domain}/logout`,
  };
}

function isStoredAuth(value: unknown): value is StoredAuth {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { accessToken?: unknown }).accessToken === "string" &&
    typeof (value as { idToken?: unknown }).idToken === "string"
  );
}

function toTokenResponse(auth: StoredAuth): AuthSession.TokenResponse {
  return new AuthSession.TokenResponse(auth);
}

export function createStoredAuth(tokenResponse: AuthSession.TokenResponse): StoredAuth {
  const config = tokenResponse.getRequestConfig();
  if (!config.idToken) {
    throw new Error("Cognito did not return an id token.");
  }

  return config as StoredAuth;
}

export async function signInWithPassword(email: string, password: string): Promise<StoredAuth> {
  const response = await fetch(`https://cognito-idp.${getCognitoRegion()}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: getCognitoClientId(),
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }),
  });

  const payload = (await response.json()) as {
    AuthenticationResult?: {
      AccessToken: string;
      IdToken: string;
      RefreshToken?: string;
      TokenType?: string;
      ExpiresIn?: number;
    };
    ChallengeName?: string;
    message?: string;
    Message?: string;
    __type?: string;
  };

  if (!response.ok) {
    throw new Error(payload.message || payload.Message || payload.__type || "Password sign-in failed.");
  }

  if (!payload.AuthenticationResult?.AccessToken || !payload.AuthenticationResult.IdToken) {
    if (payload.ChallengeName) {
      throw new Error(`Unsupported Cognito challenge: ${payload.ChallengeName}`);
    }

    throw new Error("Cognito did not return an access token.");
  }

  return {
    accessToken: payload.AuthenticationResult.AccessToken,
    idToken: payload.AuthenticationResult.IdToken,
    refreshToken: payload.AuthenticationResult.RefreshToken,
    tokenType: "bearer",
    expiresIn: payload.AuthenticationResult.ExpiresIn,
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

export async function getStoredAuth(): Promise<StoredAuth | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
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
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(auth));
}

export async function clearStoredAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

export async function getValidStoredAuth(options: { forceRefresh?: boolean } = {}): Promise<StoredAuth | null> {
  const current = await getStoredAuth();
  if (!current?.idToken) {
    return null;
  }

  const tokenResponse = toTokenResponse(current);
  if (!options.forceRefresh && !tokenResponse.shouldRefresh()) {
    return createStoredAuth(tokenResponse);
  }

  if (!tokenResponse.refreshToken) {
    return createStoredAuth(tokenResponse);
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = tokenResponse
    .refreshAsync(
      {
        clientId: getCognitoClientId(),
      },
      getHostedUiDiscovery(),
    )
    .then(async (nextTokenResponse) => {
      const nextAuth = createStoredAuth(nextTokenResponse);
      await persistStoredAuth(nextAuth);
      return nextAuth;
    })
    .catch(async (caught) => {
      if (caught instanceof TokenError && caught.code === "invalid_grant") {
        await clearStoredAuth();
        return null;
      }

      throw caught;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export async function getValidIdToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  return (await getValidStoredAuth(options))?.idToken || null;
}

export async function getSelectedDeviceId(): Promise<string | null> {
  return (await SecureStore.getItemAsync(SELECTED_DEVICE_KEY)) || null;
}

export async function setSelectedDeviceId(deviceId: string | null): Promise<void> {
  if (!deviceId) {
    await SecureStore.deleteItemAsync(SELECTED_DEVICE_KEY);
    return;
  }

  await SecureStore.setItemAsync(SELECTED_DEVICE_KEY, deviceId);
}
