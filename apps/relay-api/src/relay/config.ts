import type { RelayStoreConfig, RelayStoreLocalAdminMethodConfig, RelayStoreOidcMethodConfig } from "./types";

export const CONNECT_TOKEN_TTL_MS = 5 * 60_000;
export const PAIRING_CODE_TTL_MS = 10 * 60_000;
export const PRESENCE_TTL_SECONDS = 90;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const DEVICE_CHANNEL = "rc:ws:device";
export const CLIENT_CHANNEL = "rc:ws:client";
export const RPC_RESPONSE_CHANNEL = "rc:rpc:response";

type OidcDiscoveryDocument = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
};

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function getRequiredEnv(name: string, fallback?: string | null): string {
  const value = process.env[name]?.trim() || fallback || "";
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalBooleanEnv(name: string, fallback = false): boolean {
  const value = getOptionalEnv(name);
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getOptionalNumberEnv(name: string, fallback: number): number {
  const value = getOptionalEnv(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }

  return parsed;
}

function splitScopes(input: string | null): string[] {
  const scopes = (input || "openid,email")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return Array.from(new Set(scopes));
}

function getLegacyCognitoIssuer(): string | null {
  const userPoolId = getOptionalEnv("COGNITO_USER_POOL_ID");
  const region = getOptionalEnv("COGNITO_REGION") || getOptionalEnv("AWS_REGION");
  if (!userPoolId || !region) {
    return null;
  }

  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

async function discoverOidcDocument(issuer: string): Promise<OidcDiscoveryDocument> {
  const wellKnownUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(wellKnownUrl);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed for ${issuer}: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as Partial<OidcDiscoveryDocument>;
  if (!payload.authorization_endpoint || !payload.token_endpoint || !payload.jwks_uri) {
    throw new Error(`OIDC discovery for ${issuer} did not return the required endpoints.`);
  }

  return {
    authorization_endpoint: payload.authorization_endpoint,
    token_endpoint: payload.token_endpoint,
    jwks_uri: payload.jwks_uri,
    revocation_endpoint: payload.revocation_endpoint,
    end_session_endpoint: payload.end_session_endpoint,
  };
}

async function loadOidcMethods(): Promise<RelayStoreOidcMethodConfig[]> {
  const issuer = getOptionalEnv("OIDC_ISSUER") || getLegacyCognitoIssuer();
  const clientId = getOptionalEnv("OIDC_CLIENT_ID") || getOptionalEnv("COGNITO_WEB_CLIENT_ID");
  if (!issuer || !clientId) {
    return [];
  }

  const discovery = await discoverOidcDocument(issuer);
  return [
    {
      id: getOptionalEnv("OIDC_METHOD_ID") || "oidc",
      type: "oidc",
      label: getOptionalEnv("OIDC_METHOD_LABEL") || "Sign In with Relay Identity",
      issuer,
      clientId,
      authorizationEndpoint: getOptionalEnv("OIDC_AUTHORIZATION_ENDPOINT") || discovery.authorization_endpoint,
      tokenEndpoint: getOptionalEnv("OIDC_TOKEN_ENDPOINT") || discovery.token_endpoint,
      revocationEndpoint: getOptionalEnv("OIDC_REVOCATION_ENDPOINT") || discovery.revocation_endpoint || null,
      endSessionEndpoint: getOptionalEnv("OIDC_END_SESSION_ENDPOINT") || discovery.end_session_endpoint || null,
      scopes: splitScopes(getOptionalEnv("OIDC_SCOPES")),
      pkce: true,
      jwksUri: getOptionalEnv("OIDC_JWKS_URI") || discovery.jwks_uri,
    },
  ];
}

function loadLocalAdminMethods(): RelayStoreLocalAdminMethodConfig[] {
  const bootstrapToken = getOptionalEnv("RELAY_LOCAL_ADMIN_BOOTSTRAP_TOKEN");
  const enabled = getOptionalBooleanEnv("RELAY_LOCAL_ADMIN_ENABLED", Boolean(bootstrapToken));
  if (!enabled) {
    return [];
  }

  return [
    {
      id: getOptionalEnv("RELAY_LOCAL_ADMIN_METHOD_ID") || "local-admin",
      type: "local-admin",
      label: getOptionalEnv("RELAY_LOCAL_ADMIN_METHOD_LABEL") || "Sign In with Local Admin",
      setupRequired: false,
      bootstrapEnabled: Boolean(bootstrapToken),
      bootstrapToken,
    },
  ];
}

export async function loadRelayStoreConfig(port: number): Promise<RelayStoreConfig> {
  const oidcMethods = await loadOidcMethods();
  const localAdminMethods = loadLocalAdminMethods();

  if (!oidcMethods.length && !localAdminMethods.length) {
    throw new Error("Relay auth is not configured. Define OIDC_* or RELAY_LOCAL_ADMIN_* environment variables.");
  }

  return {
    port,
    serverName: getOptionalEnv("RELAY_SERVER_NAME") || "Remote Codex Relay",
    databaseHost: getRequiredEnv("DB_HOST"),
    databasePort: Number(getRequiredEnv("DB_PORT", "3306")),
    databaseName: getRequiredEnv("DB_NAME", "remote-codex"),
    databaseUser: getRequiredEnv("DB_USER"),
    databasePassword: getRequiredEnv("DB_PASSWORD"),
    valkeyUrl: getRequiredEnv("VALKEY_URL"),
    authSessionSecret: getRequiredEnv("RELAY_AUTH_SESSION_SECRET"),
    authAccessTokenTtlSeconds: getOptionalNumberEnv("RELAY_AUTH_ACCESS_TOKEN_TTL_SECONDS", 15 * 60),
    authRefreshTokenTtlSeconds: getOptionalNumberEnv("RELAY_AUTH_REFRESH_TOKEN_TTL_SECONDS", 30 * 24 * 60 * 60),
    oidcMethods,
    localAdminMethods,
    defaultOidcIssuer: oidcMethods[0]?.issuer || null,
  };
}
